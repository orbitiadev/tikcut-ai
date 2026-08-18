# TikCut AI

Editor pessoal, local-first, focado exclusivamente em transformar vídeos longos/podcasts em cortes verticais para TikTok.

## O que já funciona nesta base

- Importação local de vídeo sem upload obrigatório.
- Preview 9:16 com área segura para interface do TikTok.
- Marcação de IN/OUT e seleção do trecho.
- Análise local de silêncios via Web Audio API.
- Ranking de trechos por sinais textuais (hook, clareza e emoção) a partir de uma transcrição fornecida.
- Três estilos de legenda no preview.
- Exportação local MP4 1080x1920 usando FFmpeg WebAssembly.
- Projeto salvo no navegador.
- Supabase opcional para login por Magic Link e sincronização de projeto.
- Banco com RLS por usuário e bucket privado para mídia.
- PWA básica e CI de build/typecheck.

## Limites honestos da v0.1

- O ranking de cortes é heurístico, não uma promessa de viralidade.
- Sem timecodes reais na transcrição, os tempos sugeridos são estimados pela posição do texto.
- A legenda ainda não é queimada no MP4 exportado; ela aparece no preview. Queima de legenda e word-level timing entram na camada de renderização avançada.
- Transcrição automática local (Whisper/WebGPU) e auto-reframe por rosto exigem modelos adicionais e precisam ser validados por dispositivo para não travar celulares modestos.
- FFmpeg.wasm processa no dispositivo; vídeos muito longos podem exigir bastante RAM.

## Supabase

Use um projeto dedicado. A migration em `supabase/migrations/` cria as tabelas, RLS e o bucket `project-media`. Use somente a Publishable Key no frontend; nunca coloque service role/secret key no app.

Variáveis:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

## Vercel

Framework preset: Vite. Build command: `npm run build`. Output: `dist`.

## Privacidade

O fluxo principal foi desenhado para manter vídeo e renderização no dispositivo. Upload para Supabase é opcional. O projeto não depende de copiar código, modelos ou ativos proprietários de editores pagos; os recursos são implementados com lógica própria e componentes open source.
