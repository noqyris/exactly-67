# Exactly 67 — šta treba

Stanje: **17. 10. 2026. popodne.** Šta je urađeno i kako: `IZVESTAJ-2026-10-17.md` (i stariji
`IZVESTAJ-2026-10-12.md`).
Stavke su po redu. Kad se neka završi, obriši je ili precrtaj.

**Gde stoji:** 1.3.1 je u prodaji od 11. 10. Verzija **1.3.2** je spremna u kodu (grana
`feat/monetization`, poslata) i na TestFlight-u je kao build **41 sa LAŽNIM reklamama** za tvoje
testiranje. Ništa ne čeka pregled. U 30 dana: 0 prikaza reklama, 0 ocena, ~8 preuzimanja.

## Sada

0. **Ti: testiraj build 41 (1.3.2, LAŽNE reklame) sa TestFlight-a.** Dodat si u novu grupu
   „Internal · safe builds" (prihvati pozivnicu ako stigne). Reklame i kupovine su lažne (crtamo ih
   sami, piše „FAKE AD — MOCK BUILD" / „FAKE PURCHASE"); slobodno tapkaj. Nivoi se otključavaju
   redom. Javi šta ti se ne sviđa — to ide pre izdanja. Ubuduće u tu grupu idu samo bez-reklama i
   lažni build-ovi; build sa pravim reklamama nikad.

1. **Ti: odluka o granama.** Izdanje koje je u prodaji je sa grane `feat/monetization`, ne sa
   `main`. Na `main` je samo strana politike, jer se javni sajt služi iz `main` → `/docs`. Ako
   spajaš, pazi da u `docs/` ne uđe ništa što ne sme da bude javno; zato su ovaj spisak i izveštaj
   u korenu repoa.
2. **Claude, 18. 10. ili kasnije: merenje.** Izdanje se meri po verziji aplikacije, sedam dana
   posle izlaska:
   `node ~/.claude/skills/mobile-game-playbook/scripts/levelplay-daily.js 2026-10-11 2026-10-18 --by-version`
   Brojevi će biti mali; gleda se da li se reklame uopšte pokreću u 1.3.1.

## Uz sledeće izdanje 1.3.2 (jedan par, 42/43 — 41 je zauzet lažnim build-om)

- ~~**Tiho odbijanje.**~~ Urađeno 17. 10.: deo 8 (`PATCHED-QUIET-REFUSAL`) je u
  `scripts/patch-levelplay-consent.mjs`, oba sistema (iOS ×2, Android ×1 + ×1), u tabelama kapija
  i u Xcode proveri; `ios:sync` prolazi. Ulazi u sledeće izdanje samo od sebe.
- **Snimak ATT upita pre slanja.** Apple ga je 12. 10. tražio za Quadshot i Moonsoon. Jednom
  po igri: build sa lažnim ključem na tvoj telefon, ti snimiš ekran, snimak ide kao prilog
  pregledu (`asc-review-attachment.mjs`). Bez toga isto odbijanje može da stigne i ovde.

## Za igrače

- ~~Ključne reči za en-GB, en-AU i en-CA.~~ Pripremljeno 17. 10. u `ios/App/fastlane/metadata/` (detalji u `store/STORE_LISTING.md`); ide sa sledećom verzijom, jer se ključne reči ne menjaju bez nje. Posle izlaska proveri u Nemačkoj pretragu `exactly equation` (opis provere je u istom fajlu).

## Iz plana zarade (proveriti u kodu da li još važi)

- ~~Ponuda „pomoć za reklamu, a svoju zadrži".~~ Urađeno 17. 10. (commit `f489087`): pri 1–2 pomoći
  dodir na sijalicu nudi „Use 1 hint" ili „Watch ad: keep my hint". Istraživanje je spustilo procenu
  na mali rast (do ~15% nagradnih reklama), ne +30–80%, jer igrač retko ostane bez pomoći.
- ~~Ulaz u Daily na kartici pobede.~~ Urađeno 17. 10. (commit `5fb35d8`), za igrače koji ga nisu
  otkrili.

## Tvoje odluke (iz istraživanja 17. 10.)

- ~~**Veličina dnevnog poklona.**~~ Urađeno 17. 10. uz tvoj zadatak „maksimalna zarada": 1·2·3·4·5 i
  Star Jar 25 (commit `0679333`). Vraća se jednom izmenom u `src/game/economy.ts` ako ti se ne sviđa.
- **Podešavanja prodavnice — za tvoje „da" (ništa nije menjano):**
  - *Small Business Program* u App Store Connect (Agreements): ako nisi upisan, Apple uzima 15% umesto
    30% — najsigurnijih +21% od kupovina. Upis radiš ti.
  - ~~*Cene kupovina*~~ — urađeno 17. 10. uz tvoje „može": Unlimited Hints + No Ads **$9.99**, 100 Hints
    **$4.99**, No Ads **$1.99** (US osnova, ostale zemlje izjednačio Apple; promenjene tačno te tri u
    svih 175 prodavnica, ostale iste). Vraća se istom skriptom: `node tools/asc/reprice.mjs`.
  - *In-App Event* „Daily Challenge" (besplatna vidljivost u pretrazi i Today).
  - *ASC_VENDOR* (vendor broj iz Payments and Financial Reports) u `../kvizko/.env`, da se preuzimanja
    i kupovine mere skriptom.
  - *Unity / LevelPlay: podaci za isplatu i porez* — proveri da su uneti, inače mali iznosi nikad ne stižu.
- **Nivoi 70–72** su po formuli generatora teži od svega do otprilike nivoa 530, a moraju da se pređu
  redom. Mogući zid na kome igrači odustaju.
- **Pitanje o reklamama posle nivoa 8 umesto posle nivoa 1.** U ovoj igri reklama ne dolazi pre
  nivoa 9, pa ranije pitanje ništa ne donosi. To je tvoje pravilo za sve igre.
- **Preuzimanja su najveća poluga.** Pri ~8 mesečno nijedna promena zadržavanja se ne vidi u
  brojkama; listing, prevodi igre i video vrede više.

## Ne radi se

- Android. Po tvojoj odluci od 11. 10. na Android ide samo KVIZKO.

## Zajedničko za sve igre

Ovaj deo je isti u svakom projektu.

- **Odgovor Unity podršci** o ironSource Exchange-u čeka da ga pošalješ. Tekst i objašnjenje su u
  `~/Desktop/Noqyris/hq/projects/games/unity-support-isx-age.md`. Dok oni ne potvrde blokade i dok
  ti ne odlučiš, ironSource Exchange ostaje isključen u svim aplikacijama.
- **App Store Connect u Chrome-u za automatizaciju je odjavljen** (12. 10. uveče). Prijava treba
  samo kad Claude radi u web delu: odgovor Apple-u na odbijanje i oznake privatnosti.
- **Pravila koja se ne krše:** build sa pravim reklamama se nikad ne instalira i ne otvara, ni na
  telefonu ni na simulatoru. Svako izdanje je par: pravi build N, pa odmah build bez reklama N+1.
  Jedan par po izdanju. `feat/monetization` se šalje na GitHub posle svakog koraka (tvoja dozvola
  od 17. 10.); `main` i dalje samo uz tvoju reč.
- **Simulator na ovom računaru ne radi:** „CoreSimulator is out of date". Popravka (traži lozinku):
  `sudo xcodebuild -runFirstLaunch`.
- **Snimak upita za praćenje (ATT)** se pravi iz posebnog build-a sa lažnim reklamnim ključem, koji
  ne može da učita nijednu reklamu. Postupak je u playbook-u:
  `~/.claude/skills/mobile-game-playbook/references/app-store.md`, odeljak o ATT snimku.
- **Ceo plan zarade:** https://claude.ai/artifact/11xZitt15r7Tg4q1mRBxRf
- **Kako početi sa Claude-om u ovom projektu:** „pročitaj `STA-TREBA.md` i
  `IZVESTAJ-2026-10-17.md`, pa kreni od prve stavke".
