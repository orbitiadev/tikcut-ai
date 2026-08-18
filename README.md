# TikCut AI

Editor de vídeo local-first para cortes verticais, vídeos longos, TikTok, Reels e Shorts.

## Versão 0.3 — Editor + Studio Pro + Storyverse

O TikCut foi organizado em três áreas principais:

- **Editor:** corte IN/OUT rápido, preview, download e exportação vertical.
- **STUDIO PRO:** transcrição local, remoção automática de silêncios, Auto Zoom, Auto B-roll, Autopilot, pacote social, Fruit AI local e timeline multicamada.
- **STORYVERSE:** criação de séries, personagens e episódios com continuidade local.

Há também um **Guia de Uso** dentro da aplicação.

## Editor rápido

- Importação local de MP4, MOV, WebM e outros formatos suportados pelo navegador.
- Marcação IN/OUT por tempo atual ou segundos.
- Durações rápidas de 15, 30, 45, 60 e 90 segundos.
- Preview somente do trecho selecionado.
- Corte real para novo MP4.
- Tentativa de stream copy antes de recodificar.
- Fallback para H.264/AAC quando necessário.
- Exportação 1080 × 1920 em 9:16.
- Detecção de pausas/silêncios.
- Ranking de cortes por sinais textuais.
- Projeto salvo localmente.
- Supabase opcional para Magic Link e sincronização.

## STUDIO PRO

### Transcrição automática

- Whisper executado no navegador usando `@huggingface/transformers`.
- WebGPU é tentado quando disponível; há fallback local.
- Trechos de até 10 minutos por execução para proteger a memória do navegador.
- Timestamps e exportação SRT.
- Texto continua editável depois da transcrição.

### Remoção automática de silêncios

- Detecta pausas no áudio.
- Calcula os segmentos mantidos.
- Concatena automaticamente as partes faladas.
- Gera novo MP4 sem modificar o original.
- Pode gerar saída normal ou vertical 9:16.

### Auto Zoom

- Estilos: Podcast, Storytime, Gaming, Motivacional, Cinematic, Meme e Satisfying.
- Usa falas com ênfase, pontuação e ritmo para planejar zooms.
- Evita aplicar eventos rítmicos dentro de pausas detectadas.
- Os eventos aparecem na faixa `ZOOM/FX` da timeline.
- Render 9:16 pelo FFmpeg WebAssembly.

### Título, descrição, hooks e hashtags

- Usa a API de IA local do Chrome quando ela existe e está disponível no dispositivo.
- Caso contrário usa um motor local determinístico.
- A interface informa qual provedor foi usado.
- Não existe promessa de viralização.

### Auto B-roll

- Sugere palavras-chave e intervalos a partir da transcrição.
- Pesquisa mídia no Wikimedia Commons.
- Exibe fonte, autoria e licença quando fornecidas pelo Commons.
- Permite inserir mídia na faixa `B-ROLL`.
- O Autopilot vertical pode baixar as mídias escolhidas e incorporá-las diretamente no MP4 final.
- Falha de uma fonte externa não deve impedir a exportação do vídeo principal.

### AUTOPILOT

O Autopilot pode combinar, de forma configurável:

1. transcrição local quando necessária;
2. detecção e remoção de silêncios;
3. formato vertical 9:16;
4. Auto Zoom;
5. planejamento de B-roll;
6. busca de mídia licenciada;
7. incorporação de B-roll no MP4 vertical;
8. títulos, descrição, hooks e hashtags;
9. atualização da timeline editável;
10. renderização e download do resultado.

As decisões permanecem revisáveis na interface.

### Timeline profissional multicamada

Faixas atuais:

- `VÍDEO`
- `B-ROLL`
- `TEXTO`
- `ÁUDIO`
- `ZOOM/FX`

A timeline possui playhead, régua, zoom temporal, seleção de itens, movimentação de blocos desbloqueados, ajuste de IN/OUT e exclusão de itens editáveis.

### Fruit AI local

O modo atual cria um storyboard por IA local quando possível, busca mídia licenciada e monta um vídeo vertical animado com FFmpeg.

**Importante:** isso não é o mesmo que um gerador diffusion/text-to-video fotorrealista. Geração visual sintética do zero continua preparada para integração futura com um provedor dedicado e credencial segura.

## Privacidade e arquitetura

- O fluxo pesado do editor é local-first.
- Arquivos de vídeo não precisam ser enviados para um servidor para corte/renderização.
- Supabase é opcional para autenticação e sincronização de dados de projeto.
- Nenhuma Service Role deve ser colocada no frontend.
- B-roll externo só é baixado quando o usuário executa essa função.
- A aplicação não copia código ou ativos proprietários de editores pagos.

## Limites de estabilidade

A fonte pode ter mais de uma hora, mas cada render local é limitado a **10 minutos por trecho**. O objetivo é evitar consumo excessivo de RAM no navegador. Para vídeos longos, produza vários shorts menores.

Whisper e FFmpeg WebAssembly podem consumir CPU, memória e bateria. O desempenho depende do aparelho e navegador.

## Supabase

Use apenas a Publishable Key no frontend.

Variáveis:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

A migration em `supabase/migrations/` mantém RLS por usuário e mídia privada quando o sync é utilizado.

## Vercel

Framework: Vite  
Build: `npm run build`  
Output: `dist`

O projeto de produção está conectado ao repositório `orbitiadev/tikcut-ai`. A branch `main` é a fonte para deploys de produção.

## Qualidade

O repositório inclui:

- TypeScript build/typecheck;
- Playwright E2E;
- testes de fontes longas de 65 minutos;
- MP4 H.264/AAC em Chrome;
- corte real com validação por `ffprobe`;
- regressões de Storyverse, mobile, Supabase e persistência;
- testes dedicados do Studio Pro para timeline, Auto Zoom, remoção de silêncio e Autopilot.

Não trate uma funcionalidade como validada apenas porque existe visualmente: recursos novos só devem chegar à `main` depois dos testes correspondentes passarem.
