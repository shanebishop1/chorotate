import type { Route } from "./+types/terms";
import { LegalPage } from "./legal-page";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Terms · ChoRotate" },
    {
      name: "description",
      content: "Terms for using the private ChoRotate household service.",
    },
  ];
}

export default function Terms() {
  return (
    <LegalPage
      title="Terms"
      description="ChoRotate coordinates one household’s chore schedule. These terms keep that shared record useful, accurate, and private."
    >
      <section>
        <h2>Authorized use</h2>
        <p>
          The service is for invited household members only. Members must use
          their own Google account, keep access credentials secure, and avoid
          attempting to reach another person’s account or restricted service
          data.
        </p>
      </section>
      <section>
        <h2>Household record</h2>
        <p>
          ChoRotate is the household’s shared scheduling record. Members are
          responsible for reviewing changes before submitting them and for
          raising mistakes with the household administrator. Assignment changes
          may be retained in an audit history.
        </p>
      </section>
      <section>
        <h2>Reminders</h2>
        <p>
          SMS reminders are optional and may incur carrier charges. A member may
          withdraw reminder consent through the household administrator.
          Delivery is not guaranteed, and an ambiguous provider response is not
          automatically retried.
        </p>
      </section>
      <section>
        <h2>Availability and changes</h2>
        <p>
          The service is provided for household convenience and may be changed,
          paused, or discontinued. Reasonable care is taken to preserve the
          schedule and audit record, but uninterrupted availability is not
          promised.
        </p>
      </section>
      <section>
        <h2>Questions</h2>
        <p>
          Questions about these terms, account access, or household records
          should be directed to the household administrator through the support
          address shown on the Google consent screen.
        </p>
      </section>
    </LegalPage>
  );
}
