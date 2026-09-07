import type { AuthorizedMember } from "../auth/access";
import { AuthorizationError } from "../auth/access";
import { requireAuthorizedMember } from "../auth/better-auth";
import {
  getActiveMembers,
  getCurrentAndNext,
  getGroupedHistory,
  getHouseholdCalendar,
  getHouseholdList,
  getPersonalAgenda,
  type ReadModelContext,
} from "../domain/read-models";
import { MATERIALIZATION_HORIZON_PERIODS } from "../domain/rotation/prepare";
import type { D1DatabaseLike } from "../domain/storage/d1";
import {
  ChoreRelayShell,
  type ChoreRelayData,
} from "../features/chore-relay/chore-relay-shell";
import {
  normalizeHouseholdRange,
  normalizeView,
} from "../features/chore-relay/model";
import { cloudflareContext } from "../runtime/context";
import type { RuntimeConfig } from "../runtime/environment";
import { isLocalDevelopmentRequest } from "../auth/local-development";
import type { Route } from "./+types/home";
import { runHomeAction, type HomeActionData } from "./home-action";
import { useLocation, type ShouldRevalidateFunctionArgs } from "react-router";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "ChoRotate" },
    {
      name: "description",
      content: "Private household chore schedule.",
    },
  ];
}

export type HomeLoaderData =
  | {
      state: "unauthorized";
      view: ReturnType<typeof normalizeView>;
      localAuthAvailable: boolean;
    }
  | {
      state: "unavailable";
      view: ReturnType<typeof normalizeView>;
      localAuthAvailable: boolean;
    }
  | ({
      state: "ready";
      view: ReturnType<typeof normalizeView>;
      localAuthAvailable: boolean;
    } & ChoreRelayData);

interface HomeServices {
  authorize(
    request: Request,
    database: D1Database,
    config: RuntimeConfig,
  ): Promise<AuthorizedMember>;
  now(): Date;
}

const services: HomeServices = {
  authorize: requireAuthorizedMember,
  now: () => new Date(),
};

const READ_PAGE_SIZE = 100;
const HOUSEHOLD_ASSIGNMENT_CAP = 200;

function authorizedReads(
  database: D1DatabaseLike,
  member: AuthorizedMember,
): ReadModelContext {
  return {
    database,
    authorizer: {
      async requireAuthorizedMember() {
        return member;
      },
    },
  };
}

export async function loadHomeData(
  request: Request,
  database: D1Database,
  config: RuntimeConfig,
  dependencies: HomeServices = services,
): Promise<HomeLoaderData> {
  const search = new URL(request.url).searchParams;
  const view = normalizeView(search.get("view"));
  const householdRange = normalizeHouseholdRange(search.get("range"));
  const localAuthAvailable = isLocalDevelopmentRequest(request, config);
  try {
    const member = await dependencies.authorize(request, database, config);
    const now = dependencies.now();
    const context = authorizedReads(database, member);
    const localToday = localDateAt(now, config.household.timeZone);
    const upcomingWindow = householdUpcomingWindow(localToday);
    const candidateWindow = {
      fromDate: upcomingWindow.fromDate,
      toDate: addLocalDays(localToday, MATERIALIZATION_HORIZON_PERIODS * 7),
    };
    const [
      current,
      mine,
      householdList,
      household,
      history,
      activeMembers,
      assignmentCandidates,
    ] = await Promise.all([
      getCurrentAndNext(context, { request, now }),
      getPersonalAgenda(context, { request, now, limit: 100 }),
      getBoundedHouseholdList(context, {
        request,
        now,
        fromDate: "0001-01-01",
        toDate: "9999-12-31",
      }),
      getHouseholdCalendar(context, {
        request,
        now,
        ...upcomingWindow,
      }),
      getGroupedHistory(context, { request, limit: 25 }),
      getActiveMembers(context, { request }),
      getBoundedHouseholdList(context, {
        request,
        now,
        ...candidateWindow,
      }),
    ]);
    return {
      state: "ready",
      view,
      localAuthAvailable,
      signedInMember: member,
      householdRange,
      localToday,
      current,
      mine,
      householdList,
      household,
      history,
      activeMembers,
      assignmentCandidates: assignmentCandidates.items,
    };
  } catch (error) {
    if (
      error instanceof AuthorizationError &&
      (error.status === 401 || error.status === 403)
    ) {
      return { state: "unauthorized", view, localAuthAvailable };
    }
    return { state: "unavailable", view, localAuthAvailable };
  }
}

type HouseholdListResult = Awaited<ReturnType<typeof getHouseholdList>>;

async function getBoundedHouseholdList(
  context: ReadModelContext,
  input: Omit<Parameters<typeof getHouseholdList>[1], "limit" | "offset">,
): Promise<HouseholdListResult> {
  const items: HouseholdListResult["items"] = [];
  let offset = 0;
  let nextOffset: number | null = 0;
  while (nextOffset !== null && items.length < HOUSEHOLD_ASSIGNMENT_CAP) {
    const page = await getHouseholdList(context, {
      ...input,
      limit: Math.min(READ_PAGE_SIZE, HOUSEHOLD_ASSIGNMENT_CAP - items.length),
      offset,
    });
    items.push(...page.items);
    nextOffset = page.page.nextOffset;
    offset = nextOffset ?? offset;
  }
  return {
    state: items.length === 0 ? "empty" : "ready",
    items,
    page: {
      limit: HOUSEHOLD_ASSIGNMENT_CAP,
      offset: 0,
      nextOffset,
    },
  };
}

function addLocalDays(localDate: string, days: number): string {
  const value = new Date(`${localDate}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function householdUpcomingWindow(localToday: string): {
  fromDate: string;
  toDate: string;
} {
  return {
    fromDate: addLocalDays(localToday, -6),
    toDate: addLocalDays(localToday, 30),
  };
}

function localDateAt(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const byType = Object.fromEntries(
    parts.map(({ type, value: part }) => [type, part]),
  );
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export async function loader({
  context,
  request,
}: Route.LoaderArgs): Promise<HomeLoaderData> {
  const runtime = context.get(cloudflareContext);
  return loadHomeData(request, runtime.env.DB, runtime.config);
}

export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs): boolean {
  if (formMethod || currentUrl.pathname !== nextUrl.pathname)
    return defaultShouldRevalidate;
  const current = new URLSearchParams(currentUrl.search);
  const next = new URLSearchParams(nextUrl.search);
  const viewChanged = current.get("view") !== next.get("view");
  const rangeChanged = current.get("range") !== next.get("range");
  current.delete("view");
  next.delete("view");
  current.delete("range");
  next.delete("range");
  if (current.toString() !== next.toString()) return defaultShouldRevalidate;
  return viewChanged || rangeChanged ? false : defaultShouldRevalidate;
}

export async function action({
  context,
  request,
}: Route.ActionArgs): Promise<HomeActionData> {
  const runtime = context.get(cloudflareContext);
  return runHomeAction(request, runtime.env.DB, runtime.config);
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const activeView = normalizeView(
    new URLSearchParams(useLocation().search).get("view"),
  );
  if (loaderData.state !== "ready") {
    return (
      <ChoreRelayShell
        activeView={activeView}
        state={loaderData.state}
        localAuthAvailable={loaderData.localAuthAvailable}
      />
    );
  }
  return (
    <ChoreRelayShell
      activeView={activeView}
      state="ready"
      localAuthAvailable={loaderData.localAuthAvailable}
      data={loaderData}
    />
  );
}
