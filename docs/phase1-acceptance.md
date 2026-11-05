# Phase 1 acceptance checklist

Staging par asli phones ke saath: guard phone, host phone, visitor phone, aur desk browser. Har item ke saamne pass ya fail likhein.

## A. Pehle se invite kiya hua visitor

- [ ] Host app aur web dono se invite banta hai.
- [ ] Visitor ko SMS par link milta hai, koi app install nahi.
- [ ] Visitor ki camera photo upload hoti hai, consent ke bina pass nahi banta.
- [ ] Pass par QR, host, site aur time sahi dikhta hai.
- [ ] Guard QR scan karta hai, photo aur naam dikhta hai, poora kaam 30 second se kam mein.
- [ ] Host ko push aata hai: visitor gate par aa gaye.
- [ ] Desk par visitor "Andar hain" mein bina refresh aa jata hai.

## B. Walk-in

- [ ] Purana visitor: number daalte hi details aa jati hain.
- [ ] Naya visitor: OTP, photo, host aur consent ke bina entry nahi.
- [ ] Host ko push aata hai, approve karte hi guard ki screen badalti hai.
- [ ] Host ka note guard ko dikhta hai.
- [ ] Reject par check-in ka button nahi aata.
- [ ] Jawab na aaye: 90 second par reminder, 3 minute par backup person, 5 minute par desk par "Host ko call karein".
- [ ] App ke bina host ko SMS link milta hai aur web se approve ho jata hai.

## C. Check-out

- [ ] Gate par "Bahar" mode mein QR scan se check-out.
- [ ] Time khatam hone ke baad bhi check-out hota hai.
- [ ] Desk aur guard app dono se bina QR check-out.

## D. Gadbad wale cases

- [ ] Same QR dobara "Andar" mode mein: time aur gate ke saath "pehle hi andar" dikhta hai.
- [ ] Expired aur galat site ka pass: saaf message.
- [ ] Scan ke dauran internet band: "Entry confirm nahi hui", aur dobara scan par doosri entry nahi banti.
- [ ] Internet poora band: guard paper register par likhta hai (Phase 1 mein offline nahi).
- [ ] Camera ki permission mana: bina QR check-in ka raasta dikhta hai.
- [ ] SMS gateway fail: check-in nahi rukta, message retry hota hai.
- [ ] Admin ne device block kiya: guard ka phone turant login par.
- [ ] Do gates par same QR ek saath: sirf ek entry.

## E. Speed aur network

- [ ] India se gate scan p95 2 second ke andar.
- [ ] Jio aur Airtel dono par poora flow.
- [ ] Render deploy ke dauran desk list polling se chalti rahe.

## F. Screens

- [ ] Web: phone width par visitor page, desktop par desk, light aur dark dono mein dekh lein.
- [ ] Mobile: dhoop mein aur ek haath se guard screen use karke dekh lein.
