# Grenaa Idrætscenter - Bookingsystem (MVP)

Et moderne bookingsystem til Grenaa Idrætscenter: faciliteter, kalender,
bookinger, foreninger, en AI-drevet bookingindbakke (mailfortolkning +
konflikthåndtering), pedelinterface, offentlig bookingportal og infoskærme.

Se **ARKITEKTUR.md** for den fulde analyse (systemarkitektur, datamodeller,
brugerroller, booking- og AI-mailflow, integrationspunkter og kritiske
beslutninger, som blev truffet undervejs).

## Kom i gang

```bash
npm install
npm run db:push    # opretter SQLite-databasen ud fra skemaet
npm run db:seed    # fylder den med realistisk demodata (faciliteter, foreninger,
                    # dagens program, og to eksempel-bookingmails i indbakken)
npm run dev         # starter appen på http://localhost:3000
```

Kør `npm run db:seed` igen når som helst for at nulstille til demodata.

## Vigtige sider

- `/` - Dashboard
- `/kalender` - Kalender (liste/uge/måned, filtrerbar pr. facilitet)
- `/indbakke` - Bookingindbakke (AI-mailfortolkning, konflikthåndtering)
- `/foreninger` - Foreningsdatabase
- `/faciliteter` - Facilitetsadministration (inkl. underressourcer som Hal 1A/1B)
- `/skaerme` - Administrér infoskærme
- `/skaerm/[id]` - Selve infoskærms-visningen (fuldskærm, til et TV)
- `/pedel` - Mobilvenlig pedelvisning ("hvad sker der i dag")
- `/book` - Offentlig bookingportal (embeddable)
- `/notifikationer` - Genererede beskeder (simuleret afsendelse)
- `/login` - Login (email+kodeord) - kræves for alle sider ovenfor undtagen `/book` og `/skaerm/[id]`
- `/mit-login` - Skift eget navn/email/kodeord
- `/brugere` - Brugerstyring (kun for administratorer): opret/deaktivér personale, skift rolle, nulstil kodeord

## Teknologi

Next.js (App Router, TypeScript), Tailwind CSS, Drizzle ORM + SQLite (se
ARKITEKTUR.md for hvorfor Drizzle blev valgt frem for Prisma i dette miljø).

<!-- test: bekræfter direkte push fra Martins computer virker -->


## Pedel-app (Netlify)

Mobil-først app til pedeller i mappen `pedel-app/` (statisk HTML/JS/CSS, ingen build). Den bruger det eksisterende
bookingsystem som backend - ingen ekstra database og ingen hemmeligheder i frontend.

* **Netlify:** peg et nyt site på dette repo. `netlify.toml` i roden udgiver `pedel-app/` uden build-kommando og
  videresender `/api/*` til `https://booking.grenaaic.dk` (så login-cookien ligger på Netlify-domænet; ingen CORS).
  Hvis bookingsystemet flytter adresse, rettes `to = ...` i `netlify.toml`.
* **Login:** samme brugere som i bookingsystemet (rollen "pedel" findes allerede).
* **Demo:** knappen "Prøv med demo-data" på login-siden bruger opdigtede data i hukommelsen og rører ikke produktionsdata.
* **Lokalt:** `npx serve pedel-app` (kun demo-tilstand virker uden `/api`-proxy).
