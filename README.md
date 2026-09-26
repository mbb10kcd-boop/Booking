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

## Teknologi

Next.js (App Router, TypeScript), Tailwind CSS, Drizzle ORM + SQLite (se
ARKITEKTUR.md for hvorfor Drizzle blev valgt frem for Prisma i dette miljø).

<!-- test: bekræfter direkte push fra Martins computer virker -->
