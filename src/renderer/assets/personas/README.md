# Persona portraits

Drop a square image named **exactly after the persona id**, and it shows on that
persona's team/chat card automatically (via the glob in `PersonaAvatar.tsx`).
Until an image exists, a tidy initials chip stands in. Square images crop best
(they're shown in a circle). `.png`, `.jpg`/`.jpeg`, `.webp`, and `.svg` all work.

## Naming-mode art — the image vault

The public-safe **`pete`** cast ships as plaintext SVG (`personas/pete/<id>.svg`)
and is always shown. The three show-likeness tiers are NOT stored here as viewable
images — they live **encrypted** in `../vault/` (AES-GCM; see
`src/shared/imageVault.ts`) and are decrypted into memory only once that tier's
scavenger-hunt clue is cracked (the trivia answer IS the decryption key —
`src/renderer/services/personaVault.ts`). Until a tier is unlocked, its personas
show an initials chip.

| Mode | Switcher label | Portrait key | Vault tier |
| --- | --- | --- | --- |
| pete | Pete Monahan Representing | `pete/<id>.svg` (plaintext) | — always shown |
| distinct | Lawyers Are Circling | `cartoons/<id>` | `vault/distinct/*.enc` |
| cover | Legally Questionable | `<id>` (the photos) | `vault/cover/*.enc` |
| canon | No Lawyers Present | `<id>` (the photos) | `vault/cover/*.enc` |

The Jian Yang takeover portrait (`distinct/jian-yang*`) lives in `vault/canon/*.enc`
— the takeover only unlocks once the final clue wakes him.

To (re)generate the vault from source rasters, run `scripts/vault-tool.ts` with the
tier answers in env (see its header). The plaintext source rasters are NOT part of
this repo.

## Persona ids

| File name (any supported ext) | Persona | Role |
| --- | --- | --- |
| `richard-henderstack` | Richard Hendricks | Architect |
| `erlich-bachlund` | Erlich Bachman | Stakeholder |
| `monica-hallmark` | Monica Hall | Project Lead |
| `dinesh-chugbyte` | Dinesh Chugtai | Developer |
| `bighead-bignetti` | Big Head Bighetti | QA |
| `gilfoyle-zerotrust` | Gilfoyle | Security |
| `jared-dunnison` | Jared Dunn | Ops |
| `gavin-belch` | Gavin Belson | Advisory |
| `peter-gregorix` | Peter Gregory | Advisory |
| `russ-hanneford` | Russ Hanneman | Advisory |
| `laurie-bramwell` | Laurie Bream | Advisory |
| `jack-barkley` | Jack Barker | Advisory |
| `ron-laflambe` | Ron LaFlamme | Legal (Advisory) |

> **What ships in this (public) repo:** only the original, public-safe art — the
> `pete/` cast SVGs (Claude-produced originals) — plus the show-likeness tiers as
> AES-GCM **ciphertext** under `../vault/`. No viewable show-likeness raster exists
> in this repo or its history. This is an unofficial *Silicon Valley* parody / fan
> tribute (see the root README's Parody / Fan-Tribute Notice); the ciphertext is
> undecryptable without the scavenger-hunt answers, which are not in the source.
