export default function Guide() {
  return (
    <div className="guide-page app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">TIKCUT AI · GUIA DE USO REAL</div>
          <h1>Como usar o <span>TikCut AI</span></h1>
        </div>
        <span className="pill good">v0.7</span>
      </header>

      <main className="guide-content card">
        <section>
          <h2>1. Editor · vários cortes automáticos</h2>
          <p>Importe MP4, MOV ou WebM. Assim que a duração é lida, o Editor cria automaticamente uma fila com vários cortes distribuídos por diferentes pontos do vídeo. Você não precisa escolher os minutos manualmente. Pode alterar quantidade, duração mínima e máxima e clicar em “Gerar cortes automáticos” para refazer a fila.</p>
        </section>
        <section>
          <h2>2. Cortar a fila</h2>
          <p>Na fila, marque ou desmarque os trechos e use “Cortar selecionados”. O TikCut processa um corte de cada vez. O corte simples tenta primeiro copiar os streams sem recodificar e usa conversão automática quando necessário. Cada arquivo concluído recebe seu próprio botão “Baixar”.</p>
        </section>
        <section>
          <h2>3. Manual continua disponível</h2>
          <p>Troque o modo para “Manual” quando quiser escolher IN/OUT. Você pode usar os presets rápidos, marcar pontos no player, adicionar o trecho à mesma fila ou usar “Cortar vídeo” e “Exportar MP4 9:16” diretamente.</p>
        </section>
        <section>
          <h2>4. Vídeos de 2 horas ou mais</h2>
          <p>O Editor aceita fontes de 2h+ sem tentar transcodificar o arquivo inteiro. A fonte é montada localmente e o FFmpeg lê somente cada trecho solicitado. Cada corte individual continua limitado a até 10 minutos para preservar estabilidade; a duração do vídeo fonte pode ser muito maior.</p>
        </section>
        <section>
          <h2>5. Transcrição opcional no AutoCut</h2>
          <p>A fila automática funciona sem transcrição. Se você colar uma transcrição e usar “Analisar melhores cortes”, o ranking heurístico local ajuda a posicionar alguns trechos em regiões com sinais de hook, clareza e emoção. Os tempos continuam sendo estimativas quando o texto não tem alinhamento temporal.</p>
        </section>
        <section>
          <h2>6. STUDIO PRO</h2>
          <p>Abra “STUDIO PRO” para as ferramentas avançadas. No celular o modo compatível fica ativo para priorizar estabilidade: corte, detecção de silêncio, planejamento, storyboard, timeline e Autopilot móvel continuam disponíveis. Renders pesados exclusivos de desktop ficam ocultos em telas pequenas.</p>
        </section>
        <section>
          <h2>7. Transcrição automática local</h2>
          <p>No Studio Pro, clique em “Transcrever com Whisper local”. O TikCut extrai o áudio do intervalo selecionado e executa Whisper no navegador. Na primeira utilização o modelo precisa ser baixado. WebGPU é tentado primeiro e há fallback local quando necessário. No celular, use trechos curtos porque o modelo consome memória.</p>
        </section>
        <section>
          <h2>8. Remover todos os silêncios</h2>
          <p>Use “Detectar todos os silêncios” e depois “Remover TODOS os silêncios”. O TikCut analisa somente IN/OUT, cria os segmentos falados e gera um novo MP4. O vídeo original não é alterado.</p>
        </section>
        <section>
          <h2>9. Auto Zoom inteligente</h2>
          <p>“Planejar Auto Zoom” funciona também no celular e mostra os eventos na faixa ZOOM/FX. O render pesado “Renderizar Auto Zoom 9:16” fica oculto no modo móvel; no telefone use o Autopilot compatível, que gera uma saída vertical mais leve.</p>
        </section>
        <section>
          <h2>10. Títulos, descrição, hooks e hashtags</h2>
          <p>Depois de ter uma transcrição, clique em “Gerar pacote social”. Quando a IA local compatível do Chrome estiver disponível, o TikCut usa esse recurso no próprio dispositivo; caso contrário, utiliza um motor local determinístico. A tela informa qual caminho foi usado.</p>
        </section>
        <section>
          <h2>11. Auto B-roll</h2>
          <p>Use “Sugerir pontos de B-roll” para gerar termos e momentos. Em seguida pesquise no Wikimedia Commons ou use “Auto preencher timeline”. Cada resultado mostra fonte, autoria/licença quando disponível. A incorporação pesada automática no MP4 fica desativada no modo móvel para reduzir risco de travamento.</p>
        </section>
        <section>
          <h2>12. Timeline profissional multicamada</h2>
          <p>A timeline possui faixas separadas para VÍDEO, B-ROLL, TEXTO, ÁUDIO e ZOOM/FX. Clique em um item para selecionar, ajuste IN/OUT, arraste blocos desbloqueados para mudar o tempo, adicione textos e mova o playhead pelo ruler.</p>
        </section>
        <section>
          <h2>13. Autopilot</h2>
          <p>Escolha Podcast, Storytime, Gaming, Motivacional, Cinematic, Meme ou Satisfying. No celular, “EXECUTAR AUTOPILOT” usa o modo compatível e gera uma saída 720 × 1280 mais leve; Auto Zoom renderizado e B-roll incorporado ficam desativados. No desktop o pipeline completo pode usar esses módulos adicionais.</p>
        </section>
        <section>
          <h2>14. FINALIZADOR · legendas realmente gravadas no MP4</h2>
          <p>Abra “FINALIZADOR” depois de criar o short. Importe o vídeo, gere legendas com Whisper local, importe um SRT ou crie blocos manualmente. Edite texto, IN e OUT de cada bloco e escolha Impact, Clean ou Storytime. A prévia acompanha o tempo do vídeo.</p>
        </section>
        <section>
          <h2>15. Música e mixagem</h2>
          <p>No Finalizador, adicione um arquivo de áudio opcional e ajuste separadamente o volume da música e do áudio original. O render final mistura os áudios localmente. Se o vídeo não tiver trilha original, o TikCut usa a música sem bloquear a exportação.</p>
        </section>
        <section>
          <h2>16. Exportação final para TikTok</h2>
          <p>Clique em “Renderizar vídeo final”. A saída é MP4 H.264/AAC em 1080 × 1920 e 30 fps. As legendas são compostas dentro do arquivo final. Em celular, prefira vídeos curtos e feche outras abas antes de renderizar porque essa etapa usa bastante memória.</p>
        </section>
        <section>
          <h2>17. Criar com IA · Fruit AI</h2>
          <p>“Gerar storyboard IA” funciona no celular e cria as cenas e prompts. O render local de montagem com várias imagens fica oculto no modo móvel por ser pesado; no desktop ele pode montar mídia licenciada do Wikimedia Commons. Isso continua diferente de gerar imagem/vídeo sintético fotorrealista do zero.</p>
        </section>
        <section>
          <h2>18. STORYVERSE</h2>
          <p>Abra STORYVERSE para criar séries, personagens e episódios em continuidade. Os dados ficam salvos localmente e podem ser exportados em TXT/JSON.</p>
        </section>
        <section>
          <h2>19. Login e sincronização</h2>
          <p>Magic Link e Supabase continuam opcionais para os dados básicos do projeto. Os arquivos de vídeo e as operações pesadas do Editor, Studio Pro e Finalizador continuam local-first.</p>
        </section>

        <section className="guide-warning">
          <h2>Limites atuais que o TikCut mostra sem fingir</h2>
          <p>O AutoCut automático distribui trechos pela duração e pode usar sinais da transcrição; ele não entende semanticamente todo o vídeo sem uma transcrição/alinhamento avançado e não promete viralização. No celular, funções que exigem render pesado de desktop são ocultadas ou reduzidas para um modo compatível. Geração visual sintética fotorrealista ainda precisa de um provedor dedicado. Revise cortes, mídia, licenças, legendas, áudio e resultado final antes de publicar.</p>
        </section>
      </main>
    </div>
  );
}
