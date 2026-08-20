export default function Guide() {
  return (
    <div className="guide-page app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">TIKCUT AI · GUIA DE USO REAL</div>
          <h1>Como usar o <span>TikCut AI</span></h1>
        </div>
        <span className="pill good">v0.4</span>
      </header>

      <main className="guide-content card">
        <section>
          <h2>1. Editor rápido</h2>
          <p>Abra Editor para o fluxo mais simples: importe MP4, MOV ou WebM, marque IN/OUT, use “Prévia do corte” e depois “Cortar vídeo”. O arquivo principal fica no seu dispositivo.</p>
        </section>
        <section>
          <h2>2. Cortar e baixar</h2>
          <p>O TikCut tenta primeiro um corte rápido sem recodificar. Se o codec não permitir, converte para MP4 H.264/AAC. Quando terminar, confira a prévia e use “Baixar corte pronto”. Para 1080 × 1920, use “Exportar MP4 9:16”.</p>
        </section>
        <section>
          <h2>3. Vídeos longos</h2>
          <p>A fonte pode ter mais de uma hora. No celular, trabalhe em trechos de até 2:45 no Studio Pro para reduzir uso de memória. No Editor e no Finalizador continuam existindo limites próprios mostrados na tela.</p>
        </section>
        <section>
          <h2>4. STUDIO PRO</h2>
          <p>Abra “STUDIO PRO” para as ferramentas avançadas. No celular o modo compatível fica ativo para priorizar estabilidade: corte, detecção de silêncio, planejamento, storyboard, timeline e Autopilot móvel continuam disponíveis. Renders pesados exclusivos de desktop ficam ocultos em telas pequenas.</p>
        </section>
        <section>
          <h2>5. Transcrição automática local</h2>
          <p>No Studio Pro, clique em “Transcrever com Whisper local”. O TikCut extrai o áudio do intervalo selecionado e executa Whisper no navegador. Na primeira utilização o modelo precisa ser baixado. WebGPU é tentado primeiro e há fallback local quando necessário. No celular, use trechos curtos porque o modelo consome memória.</p>
        </section>
        <section>
          <h2>6. Remover todos os silêncios</h2>
          <p>Use “Detectar todos os silêncios” e depois “Remover TODOS os silêncios”. O TikCut analisa somente IN/OUT, cria os segmentos falados e gera um novo MP4. O vídeo original não é alterado.</p>
        </section>
        <section>
          <h2>7. Auto Zoom inteligente</h2>
          <p>“Planejar Auto Zoom” funciona também no celular e mostra os eventos na faixa ZOOM/FX. O render pesado “Renderizar Auto Zoom 9:16” fica oculto no modo móvel; no telefone use o Autopilot compatível, que gera uma saída vertical mais leve.</p>
        </section>
        <section>
          <h2>8. Títulos, descrição, hooks e hashtags</h2>
          <p>Depois de ter uma transcrição, clique em “Gerar pacote social”. Quando a IA local compatível do Chrome estiver disponível, o TikCut usa esse recurso no próprio dispositivo; caso contrário, utiliza um motor local determinístico. A tela informa qual caminho foi usado.</p>
        </section>
        <section>
          <h2>9. Auto B-roll</h2>
          <p>Use “Sugerir pontos de B-roll” para gerar termos e momentos. Em seguida pesquise no Wikimedia Commons ou use “Auto preencher timeline”. Cada resultado mostra fonte, autoria/licença quando disponível. A incorporação pesada automática no MP4 fica desativada no modo móvel para reduzir risco de travamento.</p>
        </section>
        <section>
          <h2>10. Timeline profissional multicamada</h2>
          <p>A timeline possui faixas separadas para VÍDEO, B-ROLL, TEXTO, ÁUDIO e ZOOM/FX. Clique em um item para selecionar, ajuste IN/OUT, arraste blocos desbloqueados para mudar o tempo, adicione textos e mova o playhead pelo ruler.</p>
        </section>
        <section>
          <h2>11. Autopilot</h2>
          <p>Escolha Podcast, Storytime, Gaming, Motivacional, Cinematic, Meme ou Satisfying. No celular, “EXECUTAR AUTOPILOT” usa o modo compatível e gera uma saída 720 × 1280 mais leve; Auto Zoom renderizado e B-roll incorporado ficam desativados. No desktop o pipeline completo pode usar esses módulos adicionais.</p>
        </section>
        <section>
          <h2>12. FINALIZADOR · legendas realmente gravadas no MP4</h2>
          <p>Abra “FINALIZADOR” depois de criar o short. Importe o vídeo, gere legendas com Whisper local, importe um SRT ou crie blocos manualmente. Edite texto, IN e OUT de cada bloco e escolha Impact, Clean ou Storytime. A prévia acompanha o tempo do vídeo.</p>
        </section>
        <section>
          <h2>13. Música e mixagem</h2>
          <p>No Finalizador, adicione um arquivo de áudio opcional e ajuste separadamente o volume da música e do áudio original. O render final mistura os áudios localmente. Se o vídeo não tiver trilha original, o TikCut usa a música sem bloquear a exportação.</p>
        </section>
        <section>
          <h2>14. Exportação final para TikTok</h2>
          <p>Clique em “Renderizar vídeo final”. A saída é MP4 H.264/AAC em 1080 × 1920 e 30 fps. As legendas são compostas dentro do arquivo final. Em celular, prefira vídeos curtos e feche outras abas antes de renderizar porque essa etapa usa bastante memória.</p>
        </section>
        <section>
          <h2>15. Criar com IA · Fruit AI</h2>
          <p>“Gerar storyboard IA” funciona no celular e cria as cenas e prompts. O render local de montagem com várias imagens fica oculto no modo móvel por ser pesado; no desktop ele pode montar mídia licenciada do Wikimedia Commons. Isso continua diferente de gerar imagem/vídeo sintético fotorrealista do zero.</p>
        </section>
        <section>
          <h2>16. STORYVERSE</h2>
          <p>Abra STORYVERSE para criar séries, personagens e episódios em continuidade. Os dados ficam salvos localmente e podem ser exportados em TXT/JSON.</p>
        </section>
        <section>
          <h2>17. Login e sincronização</h2>
          <p>Magic Link e Supabase continuam opcionais para dados do projeto. As operações pesadas do Editor, Studio Pro e Finalizador foram desenhadas como local-first.</p>
        </section>

        <section className="guide-warning">
          <h2>Limites atuais que o TikCut mostra sem fingir</h2>
          <p>No celular, funções que exigem render pesado de desktop são ocultadas ou reduzidas para um modo compatível. Geração visual sintética fotorrealista ainda precisa de um provedor dedicado. A disponibilidade da IA nativa do Chrome varia por navegador e aparelho. O TikCut não promete viralização. Revise cortes, mídia, licenças, legendas, áudio e resultado final antes de publicar.</p>
        </section>
      </main>
    </div>
  );
}