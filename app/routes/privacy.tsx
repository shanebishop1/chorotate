import type { Route } from "./+types/privacy";
import { LegalPage } from "./legal-page";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Privacy · ChoRotate" },
    {
      name: "description",
      content: "How ChoRotate handles household and account information.",
    },
  ];
}

export default function Privacy() {
  return (
    <LegalPage
      title="Privacy"
      description="ChoRotate is a private household tool. It uses only the information needed to authenticate members, coordinate chores, and deliver reminders."
    >
      <section>
        <h2>Information we use</h2>
        <p>
          ChoRotate receives basic Google account information, including name,
          email address, and profile details, when a member signs in. It also
          stores household membership, chore schedules, assignment changes,
          reminder preferences, and delivery status.
        </p>
      </section>
      <section>
        <h2>Why we use it</h2>
        <p>
          Information is used to verify that a person belongs to the authorized
          household, show the correct schedule, maintain an audit trail of
          assignment changes, and send configured reminders. ChoRotate does not
          sell personal information or use it for advertising.
        </p>
      </section>
      <section>
        <h2>Service providers</h2>
        <p>
          Google provides sign-in, Cloudflare hosts the application and its
          database, and Textbelt processes SMS reminders when that feature is
          enabled. These providers receive only the information needed to
          perform their service.
        </p>
      </section>
      <section>
        <h2>Retention and control</h2>
        <p>
          Household records are retained while the service is in use and until
          the household administrator removes them. Members may ask the
          household administrator to review, correct, or delete their account
          and reminder information.
        </p>
      </section>
      <section>
        <h2>Security and contact</h2>
        <p>
          Access is restricted to an explicit member allowlist, sensitive
          configuration is stored as managed secrets, and state-changing
          requests are checked against the production origin. For privacy
          questions, contact the household administrator through the support
          address shown on the Google consent screen.
        </p>
      </section>
    </LegalPage>
  );
}
