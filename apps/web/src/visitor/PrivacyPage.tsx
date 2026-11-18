/** Draft text. Must be confirmed by the company's legal team before launch (docs/runbook.md). */
export function PrivacyPage() {
  return (
    <main className="visitor-page">
      <article className="visitor-card form-card">
        <h1>Privacy notice</h1>
        <p>To record your entry and keep the premises secure, we store the following:</p>
        <ul>
          <li>Name, mobile number and company</li>
          <li>Photo</li>
          <li>ID type and its last 4 digits, if you provide them</li>
          <li>Who you visited, and your entry and exit times</li>
        </ul>
        <p>We never store your full ID number.</p>
        <p>
          Only authorised company staff can see this information. Photos and ID details are deleted after 180
          days.
        </p>
        <p>To see, correct or delete your data, please contact your host or reception.</p>
      </article>
    </main>
  );
}
