# Arkitektur og beslutninger

Dette dokument beskriver den tekniske arkitektur, datamodellen, de vigtigste
flows, og de beslutninger der er truffet undervejs i byggeriet af MVP'en -
inklusive dem der bør revurderes før rigtig drift.

## 1. Teknologistack

- **Next.js 16 (App Router, TypeScript)** - samlet frontend + API (Route
  Handlers under `src/app/api/**`).
- **Drizzle ORM + SQLite via libsql** (`src/db`). *Beslutning:* Prisma var det
  oprindelige valg, men Prisma kræver at downloade en query-engine-binary fra
  `binaries.prisma.sh` ved opsætning, og dette miljøs netværkspolitik blokerer
  den adresse. Første Drizzle-version brugte `better-sqlite3`, men den pakke
  skal ofte **kompileres lokalt** (node-gyp + Python + C++ build tools), hvis
  der ikke findes et færdigbygget binary til den præcise
  platform/Node-version - noget der typisk fejler på almindelige
  Windows-arbejdscomputere (manglende Python/Visual Studio, eller en firewall
  der blokerer download af de færdigbyggede filer fra GitHub). Dette blev
  opdaget under test hos centeret og rettet ved at skifte til **libsql**
  (`@libsql/client`), som henter et færdigbygget binary som en helt
  almindelig npm-pakke - samme kanal som alle andre afhængigheder - og derfor
  er langt mere robust på tværs af maskiner og netværk. Til rigtig drift er
  Drizzle en lige så velegnet, aktivt vedligeholdt ORM uanset databasevalg -
  skift til Prisma eller en server-database (se afsnit 7) er stadig muligt.
- **Tailwind CSS** for et konsistent, mobile-first design.
- Ingen ekstern autentificering endnu (se afsnit 7, kritiske beslutninger).

## 2. Datamodel

Se `src/db/schema.ts` for den fulde, kommenterede definition. Kerneentiteter:

`facilities` (selvrefererende `parentId` for underressourcer som Hal 1A/1B),
`organizations` (foreninger), `users` (roller), `bookings` (status,
sæsongruppe, gentagelsesregel, betaling, adgangskode), `bookingRequests` +
`bookingRequestLines` (indbakken - én mail kan indeholde flere linjer/ønsker),
`conflictLogs`, `payments`, `accessCodes`, `infoScreens`,
`notificationTemplates` + `notificationLog`, og `auditLog` (bookinghistorik på
tværs af alt).

### Facilitetshierarki og konflikter

`src/lib/facilities.ts` og `src/lib/conflicts.ts` implementerer reglen:  to
bookinger konflikter hvis de er på **samme facilitet, eller hvis den ene er
forælder/bedsteforælder til den anden** (fx "Hal 1" konflikter med "Hal 1A" og
"Hal 1B", men "Hal 1A" og "Hal 1B" konflikter ikke indbyrdes). Dette er testet
og verificeret (se afsnit 6).

## 3. Tidszoner - en vigtig, bevidst beslutning

Grenaa Idrætscenter er ét fysisk sted i én tidszone (Europe/Copenhagen).
Bookinger gemmes derfor bevidst som **"naive" lokale klokkeslæt-strenge** (fx
`2026-10-17T18:00:00`, uden `Z`-suffix), og koden bruger konsekvent lokale
`Date`-getters (`getFullYear`, `getDate`, `getDay` osv.) fremfor
UTC-varianter eller `toISOString()` til datoberegning - se `src/lib/date.ts`
for den fulde begrundelse og de delte hjælpefunktioner.

*Hvorfor dette betyder noget:* `toISOString()` konverterer til UTC, hvilket
forskyder klokkeslættet med tidszone-offsettet (+1 eller +2 afhængigt af
sommer/vintertid). Bruger man det til dato-udregninger (fx "find næste
mandag"), kan man nemt komme til at regne en dag forkert - en klassisk, svær-
at-opdage fejlkilde, som blev fundet og rettet flere steder under test af
dette projekt (se afsnit 6). Løsningen er at aldrig konvertere til UTC
internt, og i stedet konsekvent regne i lokal tid.

*Konsekvens ved fremtidig drift:* Serveren bør køre med `TZ=Europe/Copenhagen`
(standard på de fleste danske hostingudbydere, men værd at tjekke eksplicit
ved valg af driftsmiljø - se kritiske beslutninger).

## 4. AI-mailflow

`src/lib/ai/mailParser.ts` implementerer en **regelbaseret dansk
tekstfortolker** (MVP-niveau af "AI-mailassistenten"): den genkender ugedage,
klokkeslæt, datoer/perioder, og matcher facilitetsnavne mod de faciliteter der
findes i systemet. Den er bevidst bygget med samme input/output-kontrakt
(`parseBookingMail(rawText, facilities) -> ParsedMail`) som en rigtig
sprogmodel (fx Claude via Anthropics API) ville skulle implementere - så
denne ene fil kan udskiftes med et rigtigt AI-kald uden at røre resten af
systemet (indbakke, konfliktcheck, godkendelsesflow).

`src/lib/inboxActions.ts` implementerer selve godkendelses-/afvisnings-
/overtagelses-logikken: en sæsonlinje udregner alle ugentlige forekomster i
perioden og opretter én booking pr. forekomst; en konflikt kan enten afvises
(genererer et høfligt afslag) eller "overtages" (aflyser den eksisterende
booking og genererer en besked til den forening, der mister tiden) - men
**aldrig automatisk**, kun ved et eksplicit medarbejder-klik, jf. kravet om at
AI ikke ukritisk må ændre eksisterende bookinger.

`src/lib/ai/messages.ts` genererer svarteksterne (bekræftelse, afvisning,
besked til den fortrængte forening). Alle genererede beskeder logges i
`notification_log` og kan ses under **/notifikationer** - der er endnu ikke
koblet en rigtig mailudbyder på (se kritiske beslutninger).

## 5. Hvad er implementeret vs. stub i denne MVP

| Område | Status |
|---|---|
| Faciliteter + hierarki | Fuldt implementeret |
| Kalender (liste/uge/måned, filtrering) | Fuldt implementeret |
| Bookinger + konfliktdetektion | Fuldt implementeret |
| Foreninger | Fuldt implementeret (CRUD + historik) |
| Bookingindbakke + AI-mailfortolkning | Implementeret med regelbaseret parser (se afsnit 4) |
| Konflikthåndtering (afvis/overtag/foreslå alternativ) | Fuldt implementeret |
| Pedelinterface | Fuldt implementeret |
| Offentlig bookingportal | Fuldt implementeret, inkl. simuleret betaling |
| Infoskærme | Fuldt implementeret (fuldskærm, auto-opdatering hvert 30. sek.) |
| Dashboard + bookingindbakke som "indbakke" | Fuldt implementeret |
| Roller/permissions | Datamodel klar (`users.role`), men **ingen login/adgangsstyring i UI endnu** |
| Online betaling | Simuleret (statusmodel og flow er fuldt implementeret, men ingen rigtig udbyder) |
| Adgangskoder | Genereres og logges, men **ikke koblet til et rigtigt låsesystem** |
| E-mail (afsendelse/modtagelse) | Beskeder genereres og logges, men **sendes ikke rigtigt**; mails kommer ind ved at indsætte tekst i UI, ikke via en rigtig postkasse |
| Winkas/GIBBS-import | Ikke bygget - se kritiske beslutninger |

## 6. Test udført

Følgende er verificeret direkte mod den kørende applikation (API-kald og
skærmbilleder), ikke kun læst i koden:

- Scenarie 1 (sæsonbooking): en sæsonmail med tre linjer (mandag/tirsdag/
  onsdag) blev fortolket korrekt, tirsdag blev korrekt markeret som konflikt
  mod en eksisterende sæsonbooking, mandag/onsdag som ledige.
- Godkendelse af en ledig sæsonlinje opretter korrekt **alle** ugentlige
  forekomster i hele perioden (34 bookinger for en sæson september-april).
- "Overtag tid" på en konfliktlinje aflyser korrekt alle 30 eksisterende
  forekomster og opretter 34 nye, samt genererer 30 individuelle
  ændringsbeskeder.
- Scenarie 2 (enkelt forespørgsel, ledig tid): fortolket og godkendt korrekt.
- Facilitetshierarki: booking af en underressource (Hal 1A) blokerer ikke
  søsterressourcen (Hal 1B), men blokerer korrekt hele Hal 1 - testet direkte.
- Dobbeltbooking via den offentlige portal afvises korrekt (409).
- Betalingsflow (simuleret): opretter en midlertidig booking, genererer en
  adgangskode først efter "betaling" er gennemført.
- Pedelvisning og infoskærm viser korrekt dagens bookinger, matcher det
  eksempel der er beskrevet i kravspecifikationen.
- En reel fejl blev fundet og rettet under test: sæsonperioder der løber over
  et årsskifte (fx "01/09-30/04") fik oprindeligt beregnet slutåret forkert
  (sammenlignede dag- i stedet for månedstal), hvilket resulterede i at
  slutdatoen lå før startdatoen, og godkendelse dermed ikke oprettede nogen
  bookinger. Dette er rettet og verificeret.
- En anden reel fejl blev fundet og rettet: datoudregninger der brugte
  `toISOString()` på en lokal midnatstid gav den forkerte dato pga.
  tidszone-forskydning (se afsnit 3) - rettet konsekvent i hele kodebasen.

Ikke testet i denne omgang (kræver længere tid eller ægte integrationer):
sommer/vintertidsskiftet i praksis (kun tidszone-logikken er gennemgået
statisk), reel mailmodtagelse, reel betalingsudbyder, reelt låsesystem.

## 7. Kritiske beslutninger til jer

Disse bør besluttes endeligt før rigtig drift - MVP'en er bygget så alle er
lette at koble til uden at ændre resten af systemet:

1. **Hosting/drift.** Anbefaling: en platform der understøtter Next.js
   server-funktioner (fx Vercel, eller egen Node-server) med `TZ=Europe/
   Copenhagen` sat eksplicit. Databasen bør flyttes fra SQLite til en rigtig
   server-database (fx PostgreSQL) ved flere samtidige brugere - Drizzle
   understøtter dette med en minimal kodeændring.
2. **Betalingsudbyder** (fx Quickpay, Reepay eller Nets, som er almindelige i
   Danmark) - kobles på i `src/app/api/portal/pay/[paymentId]/route.ts`.
3. **Adgangskontrolsystem** - hvilket fabrikat styrer dørene i dag? Kobles på
   i `src/app/api/access-codes/route.ts`.
4. **Reel e-mail-indgang** - skal systemet have sin egen postkasse/
   forward-adresse (fx via en webhook), eller skal I fortsat indsætte
   mailtekst manuelt i indbakken?
5. **Login/identitet** - simpel egen brugerdatabase (findes allerede som
   datamodel), eller integration med Microsoft 365, som I allerede bruger?
6. **Winkas/GIBBS eksportformat** til migrering af eksisterende foreninger,
   faciliteter og bookinger - jeg kender ikke det præcise eksportformat, og
   har derfor ikke bygget en importfunktion endnu. Send gerne et eksempel på
   en eksport, så bygger jeg importen.
7. **Rigtig AI-model til mailfortolkning** - den nuværende regelbaserede
   parser dækker de mønstre der er i kravspecifikationen godt, men en rigtig
   sprogmodel vil håndtere mere uforudsigelige mailformuleringer bedre.

## 7a. Ændringer efter feedback fra centeret (løbende)

- Fjernet "Status"-feltet fra formularen for direkte oprettede bookinger -
  disse sættes nu altid automatisk til "bekræftet" (se `DIRECT_BOOKING_STATUS`
  i `BookingFormModal.tsx`); de mellemliggende GIBBS-statusser bruges ikke.
- Tidsvælgere (booking-formular og portalen) springer nu 10 minutter ad
  gangen i stedet for 1, og retter automatisk et tastet "skævt" tidspunkt til
  nærmeste 10-minutters-interval (`roundTimeString`/`roundDateTimeLocalString`
  i `src/lib/date.ts`).
- Vælges en forening, foreslås automatisk dennes registrerede kontaktperson
  (typisk formanden) i Kontaktnavn/Kontakt e-mail - felterne forbliver
  redigerbare, da det ind imellem er en anden person, der booker.
- Direkte oprettede bookinger sender nu en (simuleret) bekræftelsesmail hvis
  der er en kontaktmail, og en aflysningsmail når en booking aflyses -
  logges i `notification_log` ligesom mailindbakkens beskeder.
- Mangler man en titel, bruges foreningens navn i stedet for det generiske
  "Booking".
- Alle bookinger kan nu redigeres (facilitet, tidspunkt, kontakt, noter) -
  ikke kun aflyses og genoprettes. Tilgængeligt fra både Kalender og
  Pedelvisning.
- Man kan booke flere faciliteter på én gang (fx en hal og et mødelokale
  samtidig) uden at genindtaste kontaktoplysninger - de bliver til
  selvstændige bookinger i databasen og kan efterfølgende redigeres/aflyses
  hver for sig (fx med forskellig sluttid).
- Noter vises nu direkte i pedelvisningens liste (ikke kun ved udfoldning),
  og pedelvisningen har fået en udskriftsvenlig A4-tabelvisning (knappen
  "Udskriv", eller Ctrl+P).

## 8. Kendte begrænsninger i denne MVP

- Ingen login/session - alle sider er tilgængelige uden godkendelse. Skal
  lukkes ned før produktionsbrug.
- Ingen automatiseret test-suite (fx Playwright/Vitest) endnu - test er udført
  manuelt mod den kørende applikation, som beskrevet i afsnit 6.
- Åbningstider pr. facilitet er modelleret i databasen, men bruges endnu ikke
  til at begrænse hvornår der kan bookes.
- Kalenderens "Måned"-visning er en simpel oversigt (viser op til 3 bookinger
  pr. dag + "n mere") - kan udbygges efter behov.
