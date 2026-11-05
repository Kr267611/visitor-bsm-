/** Yeh draft hai. Launch se pehle company ke legal se confirm karwana hai (docs/runbook.md). */
export function PrivacyPage() {
  return (
    <main className="visitor-page">
      <article className="visitor-card form-card">
        <h1>Privacy notice</h1>
        <p>Aapki entry record karne aur company ki suraksha ke liye hum yeh jaankari save karte hain:</p>
        <ul>
          <li>Naam, mobile number aur company</li>
          <li>Photo</li>
          <li>ID ka type aur uske aakhri 4 digit, agar aap dein</li>
          <li>Kis se milne aaye, aur andar aane aur bahar jaane ka time</li>
        </ul>
        <p>Hum poora ID number save nahi karte.</p>
        <p>
          Yeh jaankari sirf company ke zaroori staff dekh sakte hain. Photo aur ID ki details 180 din baad delete kar
          di jati hain.
        </p>
        <p>Apna data dekhne, theek karwane ya hatwane ke liye apne host ya reception se baat karein.</p>
      </article>
    </main>
  );
}
