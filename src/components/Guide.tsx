export default function Guide() {
  return (
    <div className="guide-page app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">TIKCUT AI · GUIA DE USO REAL</div>
          <h1>Como usar o <span>TikCut AI</span></h1>
        </div>
        <span className="pill good">v0.2</span>
      </header>

      <main className="guide-content card">
        <section>
          <h2>1. Importar um vídeo</h2>
          <p>Abra o Editor e clique em “Clique aqui para escolher um vídeo”. Selecione MP4, MOV ou WebM. O arquivo é lido localmente pelo navegador; não existe upload obrigatório para cortar.</p>
        </section>
        <section>
          <h2>2. Escolher o trecho</h2>
          <p>Reproduza o vídeo e use “Marcar IN no ponto atual” para definir onde o corte começa. Depois avance e use “Marcar OUT no ponto atual”. Você também pode usar os controles IN/OUT em segundos ou os botões de duração rápida.</p>
        </section>
        <section>
          <h2>3. Conferir antes de cortar</h2>
          <p>Clique em “Prévia do corte”. O player reproduz somente o intervalo IN/OUT e para ao chegar no OUT.</p>
        </section>
        <section>
          <h2>4. Cortar o vídeo</h2>
          <p>Clique em “Cortar vídeo”. O TikCut tenta primeiro um corte rápido sem recodificar. Se o codec não permitir, ele converte automaticamente para MP4 H.264/AAC. Quando terminar, aparecerá “Corte pronto”, uma prévia do arquivo gerado e o botão “Baixar corte pronto”.</p>
        </section>
        <section>
          <h2>5. Exportar em 9:16</h2>
          <p>Use “Exportar MP4 9:16” somente quando quiser um vídeo vertical 1080 × 1920. Esse processo é mais pesado que o corte simples porque precisa recodificar o vídeo.</p>
        </section>
        <section>
          <h2>6. Vídeos de mais de 1 hora</h2>
          <p>O TikCut aceita fonte longa, mas cada saída deve ter no máximo 10 minutos. Para TikTok, Reels e Shorts, o recomendado é criar vários cortes de 15s, 30s, 45s, 60s ou 90s.</p>
        </section>
        <section>
          <h2>7. AutoCut por transcrição</h2>
          <p>Cole a transcrição no campo lateral e clique em “Analisar melhores cortes”. O TikCut ranqueia trechos do texto e sugere IN/OUT aproximados. Depois use “Aplicar IN/OUT sugerido”, confira a prévia e clique em “Cortar vídeo”.</p>
        </section>
        <section>
          <h2>8. Detectar silêncios</h2>
          <p>Clique em “Detectar pausas/silêncios”. As pausas encontradas ficam disponíveis para revisão. Nesta versão a função detecta e marca; ela ainda não remove todas as pausas automaticamente.</p>
        </section>
        <section>
          <h2>9. Legendas</h2>
          <p>Os estilos Impact, Clean e Karaoke alteram a prévia na tela. Nesta versão a legenda ainda não é gravada dentro do MP4 exportado.</p>
        </section>
        <section>
          <h2>10. Login e sincronização</h2>
          <p>Você pode usar Magic Link para entrar e sincronizar os dados do projeto no Supabase. Mesmo sem login, o editor continua funcionando localmente.</p>
        </section>
        <section>
          <h2>11. STORYVERSE</h2>
          <p>Abra STORYVERSE para criar séries, personagens e episódios em continuidade. Os dados ficam salvos localmente no navegador e podem ser exportados em TXT/JSON.</p>
        </section>

        <section className="guide-warning">
          <h2>Funções do guia antigo que ainda não existem de verdade</h2>
          <p>Autopilot completo, geração de vídeo por IA, Auto B-roll, Auto Zoom, transcrição automática, remoção automática de todos os silêncios, geração de hashtags/título/descrição e editor de timeline multicamada ainda são itens de desenvolvimento. Eles não devem aparecer como prontos enquanto não houver implementação funcional.</p>
        </section>
      </main>
    </div>
  );
}
