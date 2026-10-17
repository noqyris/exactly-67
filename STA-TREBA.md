# Exactly 67 — šta treba

Stanje: **12. 10. 2026. uveče.** Šta je urađeno i kako: `IZVESTAJ-2026-10-12.md`.
Stavke su po redu. Kad se neka završi, obriši je ili precrtaj.

**Gde stoji:** 1.3.1 je u prodaji od 11. 10. Ništa ne čeka pregled i ništa nije hitno. Igra je u
30 dana do 9. 10. imala 8 preuzimanja (Velika Britanija, Nemačka, Francuska, Tajland, SAD).

## Sada

1. **Ti: odluka o granama.** Izdanje koje je u prodaji je sa grane `feat/monetization`, ne sa
   `main`. Na `main` je samo strana politike, jer se javni sajt služi iz `main` → `/docs`. Ako
   spajaš, pazi da u `docs/` ne uđe ništa što ne sme da bude javno; zato su ovaj spisak i izveštaj
   u korenu repoa.
2. **Claude, 18. 10. ili kasnije: merenje.** Izdanje se meri po verziji aplikacije, sedam dana
   posle izlaska:
   `node ~/.claude/skills/mobile-game-playbook/scripts/levelplay-daily.js 2026-10-11 2026-10-18 --by-version`
   Brojevi će biti mali; gleda se da li se reklame uopšte pokreću u 1.3.1.

## Uz sledeće izdanje (jedan par, 41/42)

- ~~**Tiho odbijanje.**~~ Urađeno 17. 10.: deo 8 (`PATCHED-QUIET-REFUSAL`) je u
  `scripts/patch-levelplay-consent.mjs`, oba sistema (iOS ×2, Android ×1 + ×1), u tabelama kapija
  i u Xcode proveri; `ios:sync` prolazi. Ulazi u sledeće izdanje samo od sebe.
- **Snimak ATT upita pre slanja.** Apple ga je 12. 10. tražio za Quadshot i Moonsoon. Jednom
  po igri: build sa lažnim ključem na tvoj telefon, ti snimiš ekran, snimak ide kao prilog
  pregledu (`asc-review-attachment.mjs`). Bez toga isto odbijanje može da stigne i ovde.

## Za igrače

- Ključne reči za en-GB, en-AU i en-CA. Preuzimanja već dolaze sa engleskog govornog područja.

## Iz plana zarade (proveriti u kodu da li još važi)

- Ponuda „pomoć za reklamu, a svoju zadrži" kad igraču ostane jedna pomoć ili nijedna. Besplatnih
  pomoći ima toliko da reklama skoro nikad ne dođe na red. Procena: +30–80% nagradnih reklama.

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
  Jedan par po izdanju. Ništa ne ide na GitHub bez tvoje reči.
- **Snimak upita za praćenje (ATT)** se pravi iz posebnog build-a sa lažnim reklamnim ključem, koji
  ne može da učita nijednu reklamu. Postupak je u playbook-u:
  `~/.claude/skills/mobile-game-playbook/references/app-store.md`, odeljak o ATT snimku.
- **Ceo plan zarade:** https://claude.ai/artifact/11xZitt15r7Tg4q1mRBxRf
- **Kako početi sa Claude-om u ovom projektu:** „pročitaj `STA-TREBA.md` i
  `IZVESTAJ-2026-10-12.md`, pa kreni od prve stavke".
