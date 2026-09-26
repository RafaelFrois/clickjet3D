# ClickJet 3D

> O mesmo **ClickJet** — agora em 3D. Arcade espacial low-poly da **Domus Arcis**.

Voe → colete → sobreviva → faça pontos → morra → tente de novo.
Pilote um pequeno foguete pelo espaço, colete moedas, desvie de meteoros, rochas e aliens,
fuja do **alien roxo** que te persegue, pegue os **meteoros coloridos** (power-up) e bata o **High Score**.

Roda direto no navegador (desktop e mobile), sem instalar nada: **Three.js + TypeScript + Vite**.

---

## Como rodar

```bash
npm install
npm run dev        # servidor de desenvolvimento → http://localhost:5173
npm run build      # typecheck + build de produção em dist/
npm run preview    # serve o build
npm test           # testes (unitários + simulações de fairness)
npm run smoke      # teste end-to-end no Chromium headless (depois do build), salva screenshots/
```

## Deploy

### Vercel (recomendado)
O projeto já vem com [`vercel.json`](vercel.json) (framework Vite, `npm run build`, saída `dist/`,
cache longo para os assets com hash).

1. Em [vercel.com/new](https://vercel.com/new), importe o repositório `clickjet3D`.
2. Não precisa mudar nada — as configurações são lidas do `vercel.json`. Clique em **Deploy**.
3. Cada push na `main` publica em produção; cada PR ganha um link de preview.

Pela CLI: `npx vercel` (preview) e `npx vercel --prod` (produção).

### Outras hospedagens
O build usa caminhos relativos (`base: './'`), então `dist/` funciona em qualquer hospedagem
estática (itch.io, Netlify, GitHub Pages…). Para GitHub Pages há o workflow manual
`.github/workflows/deploy.yml` (*Settings → Pages → Source: GitHub Actions*, depois
*Actions → Deploy to GitHub Pages → Run workflow*).

## Controles

| Plataforma | Mover | Pausar | Outros |
|---|---|---|---|
| Teclado | WASD / setas | P / Esc | M = mute, N = próxima música |
| Mouse | **segure o clique**: o jato voa até o cursor (o "ClickJet"); um clique = vai até ali | botão ⏸ | — |
| Touch | **arraste em qualquer lugar** (relativo, o dedo não cobre o foguete) ou modo *FOLLOW* (voa até o dedo) | botão ⏸ | modo em *Settings → TOUCH* |
| Gamepad | analógico esquerdo / d-pad | Start | A = confirmar, B = voltar, Select = mute, Y = música |

Menus navegáveis por teclado/gamepad (setas + Enter/A). O jogo pausa sozinho ao perder o foco.

---

## O que foi preservado do original (2D → 3D)

| Original 2D | ClickJet 3D |
|---|---|
| Foguete sprite | Foguete low-poly azul com chama reativa (maior ao acelerar), partículas e inclinação nas curvas |
| Moeda amarela **+5** | Moeda 3D dourada com estrela, girando; partículas + som + `+5` flutuando |
| Moeda colorida **+10** | Moeda arco-íris brilhante com faíscas; `+10` flutuando |
| Meteoro de fogo | Meteoro 3D em chamas (P/M/G), cauda de fogo, faíscas, **aviso de trajetória** antes de entrar |
| Rochas marrons | Asteroides low-poly girando (5 formatos) |
| Alien verde bravo | Polvo 3D verde com sobrancelhas bravas e tentáculos animados; flutua, vagueia e (mais tarde) dá botes telegrafados |
| Alien roxo perseguidor | Polvo roxo com crista, olhos brilhantes e aura; persegue com direção + velocidade + predição simples, com assinatura sonora de proximidade |
| Meteoro colorido = power-up | Cristal com cauda arco-íris: **BONUS +10/s** por 5 s (HUD pisca no fim), aura e rastro arco-íris |
| Score, Tempo, High Score | Mesmos três, com fonte pixel, painéis azuis chanfrados e ícone de relógio |
| Game Over azul (GAME / OVER, SC, relógio) | Mesmo painel, agora com RESTART + MENU, HIGH SCORE e animação **NEW HIGH SCORE!** com confete |
| Menu: logo, PLAY, HIGH SCORE, mute, música, Domus Arcis | Tudo mantido, sobre uma cena 3D leve (foguete flutuando diante de um planeta, meteoros passando) |
| Trilha variada | 5 músicas chiptune procedurais em ordem embaralhada sem repetição imediata (A → C → B → D …) |

**Bugs corrigidos em vez de copiados:** os números do original aparecem em fonte serifada padrão
(fallback acidental) — aqui tudo usa a fonte pixel; spawns agora nunca nascem em cima do jogador.

### Extras (com moderação)
- **Combo**: moedas coletadas em sequência rápida valem x2 / x3 (some após 1,3 s sem coletar).
- **Risco × recompensa**: às vezes as moedas aparecem em anel em volta de uma rocha.
- **Eventos raros** (a cada 30–46 s, após 28 s): *Meteor Shower*, *Coin Rain*, *Alien Swarm*, *Mega Bonus* (+20/s), *Rainbow Trail*.

---

## Decisões de design

**Eixo de movimento.** O jogo continua 2D em regras: o foguete se move num **plano (X/Z)**, como
no original. O 3D é usado para câmera, profundidade, modelos e cenário — não há voo 3D livre.

**Câmera.** Terceira pessoa inclinada (56°), atrás/acima do foguete, seguindo-o suavemente
(parcialmente, com amortecimento). Sem rotação, sem shake constante, FOV moderado. O tamanho da
arena e a distância da câmera são **calculados para cada proporção de tela** (celular em pé,
18:9, 16:10, 16:9, 21:9, 32:9, tablets): a arena inteira fica visível abaixo do HUD e o foguete
fica sempre na parte de baixo da tela.

**Sensação de voo.** O mundo "corre" em direção à câmera (velocidade de cruzeiro): estrelas em
3 camadas com paralaxe, poeira, rochinhas decorativas, planeta ao fundo, meteoros entrando.

**Controle arcade.** A velocidade responde quase instantaneamente (sem inércia realista).

**Fairness (testada automaticamente).**
- Nenhum perigo nasce perto do jogador (raio de segurança) e todos entram de fora da tela.
- Meteoros são **telegrafados**: uma faixa tracejada mostra o caminho e a largura exatos antes
  de entrarem + marcador na borda da tela; rajadas sempre deixam corredores livres.
- Rochas nunca fecham uma faixa horizontal inteira (corredor mínimo garantido).
- Limite global de densidade de perigos.
- O alien roxo é sempre mais lento que o jogador (inclusive no "surto" do fim de jogo), acelera
  de forma limitada e entra pela borda mais distante, com aviso visual e sonoro.
- Power-ups sempre atravessam a área alcançável, devagar.

**Dificuldade progressiva** (nível = 1 − e^(−t/70)): não só velocidade — aumenta frequência,
quantidade, tamanho e direções dos meteoros (topo → diagonais → laterais → por trás), número de
rochas e aliens, botes dos aliens, velocidade/predição do perseguidor. Fases: *start* (<20 s),
*mid* (<75 s), *final*.

Todos os números ficam em [`src/config/balance.ts`](src/config/balance.ts).

---

## Arquitetura

```
Keyboard ─┐
Mouse ────┤
Touch ────┼─→ InputManager ─→ MoveCommand ─→ PlayerController (world/entities/Player)
Gamepad ──┘                └→ UIAction    ─→ GameManager / UIManager
```

| Módulo | Responsabilidade |
|---|---|
| `core/GameManager` | Máquina de estados (MENU → PLAYING ⇄ PAUSED → DYING → GAME OVER), loop, liga eventos a UI/áudio/efeitos |
| `core/EventBus` | Pub/sub tipado — gameplay não conhece UI nem áudio |
| `systems/GameSession` | Uma partida: compõe mundo, spawn, dificuldade, score e power-up (sem DOM/WebGL → simulável em testes) |
| `systems/SpawnManager` | Spawn centralizado de tudo + regras de fairness + eventos raros |
| `systems/DifficultyManager` | Tempo → nível → parâmetros |
| `systems/ScoreManager` / `PowerUpManager` | Pontos, combo, high score da partida / bônus por segundo |
| `world/World` + `world/entities/*` | Entidades (com pooling), movimento, colisões justas (círculos no plano) |
| `render/CameraController` | Layout adaptativo da arena, câmera de jogo/menu, screen shake |
| `render/Models` | Modelos low-poly procedurais (geometria mesclada = 1 draw call por modelo) |
| `render/ParticleSystem` | Partículas em pool, 1 draw call |
| `render/SpaceBackground` | Skybox de nebulosa, 3 camadas de estrelas, planetas, detritos |
| `render/Effects` / `render/Quality` | Explosão, faíscas, flashes / LOW-MEDIUM-HIGH + AUTO |
| `audio/AudioManager` | Música (playlist embaralhada), SFX, volumes, mute, ducking na pausa, zumbido do perseguidor |
| `ui/UIManager` | Menu, HUD, pausa, game over, settings, textos flutuantes, indicadores de borda, navegação por foco |
| `save/SaveManager` | High score, melhor tempo, mute, volumes, qualidade, shake, modo de toque (localStorage) |

### Performance
- Tudo low-poly e procedural (sem texturas pesadas), materiais Lambert simples, 3 luzes, sem sombras.
- **Object pooling** para moedas, meteoros, rochas, aliens, avisos, detritos e partículas.
- Uma partida típica: ~40–65 draw calls e ~5–7 mil triângulos.
- Qualidade **AUTO**: começa em HIGH (desktop) / MEDIUM (mobile) e reduz se o FPS ficar abaixo de ~46.
  LOW = pixel ratio 1, menos partículas, sem sprites de brilho.

---

## Personalização

- **Balanceamento:** `src/config/balance.ts`.
- **Músicas originais:** coloque os arquivos em `public/audio/music/` e adicione em
  `src/config/music.ts` (`{ kind: 'file', name: 'MINHA MÚSICA', url: 'audio/music/minha.mp3' }`).
  Elas entram na mesma rotação embaralhada das faixas procedurais.
- **Logo Domus Arcis:** `public/assets/domus-arcis.svg` é uma recriação vetorial da assinatura;
  substitua pelo arquivo original (mesmo nome, ou ajuste o `src` em `index.html`).

## Testes e QA

- `npm test` — 36 testes: pool, shuffle da trilha, save (inclusive dados corrompidos), score/combo,
  power-up, dificuldade, movimento do foguete, layout da câmera em 9 proporções de tela, trilha
  sonora e **simulações headless de partidas inteiras** (spawns seguros, meteoros entram de fora da
  tela, abertura sem morte, bot desviando, perseguidor escapável no nível máximo, power-ups
  alcançáveis, rochas nunca fecham a passagem).
- `npm run smoke` — abre o jogo no Chromium em 6 formatos de tela (16:9, 21:9, 16:10, celular em
  pé 19.5:9, celular deitado 18:9, tablet 4:3): menu, logo Domus Arcis, settings + mute salvo,
  música tocando (sinal de áudio medido), jogar, arrastar no touch, pausar, game over, restart,
  fim de jogo com power-up + chuva de meteoros, coleta de moedas, explosão e NEW HIGH SCORE;
  falha se houver qualquer erro de runtime.

Parâmetros de URL para QA: `?debug` (estatísticas: FPS, draw calls, partículas, dificuldade),
`?god` (invencível), `?seed=N` (spawns determinísticos), `?time=90` (começa com a dificuldade de 90 s).
F3 alterna o painel de FPS.

## Licença

MIT — veja [LICENSE](LICENSE). ClickJet e Domus Arcis © RafaFrois.
