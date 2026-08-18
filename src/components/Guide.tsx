export default function Guide() {
  return (
    <div className="guide-page app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">TIKCUT AI · GUIA DE USO REAL</div>
          <h1>Como usar o <span>TikCut AI</span></h1>
        </div>
        <span className="pill good">v0.3</span>
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
          <p>A fonte pode ter mais de uma hora, mas cada render local deve ter no máximo 10 minutos. Trabalhe em trechos menores para manter o navegador estável.</p>
        </section>
        <section>
          <h2>4. STUDIO PRO</h2>
          <p>Abra “STUDIO PRO” para as ferramentas avançadas. Importe o vídeo, defina IN/OUT do trecho e use os módulos de transcrição, remoção de silêncio, Auto Zoom, B-roll, Autopilot, Fruit AI e timeline multicamada.</p>
        </section>
        <section>
          <h2>5. Transcrição automática local</h2>
          <p>No Studio Pro, clique em “Transcrever com Whisper local”. O TikCut extrai o áudio do intervalo selecionado e executa Whisper no navegador. Na primeira utilização o modelo precisa ser baixado. WebGPU é tentado primeiro e há fallback local quando necessário. Depois você pode editar o texto e baixar SRT.</p>
        </section>
        <section>
          <h2>6. Remover todos os silêncios</h2>
          <p>Use “Detectar todos os silêncios” e depois “Remover TODOS os silêncios”. O TikCut cria os segmentos falados, concatena o material e gera um novo MP4. O vídeo original não é alterado.</p>
        </section>
        <section>
          <h2>7. Auto Zoom inteligente</h2>
          <p>Escolha um estilo, clique em “Planejar Auto Zoom” e revise os eventos na faixa ZOOM/FX. Depois use “Renderizar Auto Zoom 9:16”. O plano considera ritmo, falas com ênfase e pausas detectadas.</p>
        </section>
        <section>
          <h2>8. Títulos, descrição, hooks e hashtags</h2>
          <p>Depois de ter uma transcrição, clique em “Gerar pacote social”. Quando a IA local compatível do Chrome estiver disponível, o TikCut usa esse recurso no próprio dispositivo; caso contrário, utiliza um motor local determinístico. A tela informa qual caminho foi usado.</p>
        </section>
        <section>
          <h2>9. Auto B-roll</h2>
          <p>Use “Sugerir pontos de B-roll” para gerar termos e momentos. Em seguida pesquise no Wikimedia Commons ou use “Auto preencher timeline”. Cada resultado mostra fonte, autoria/licença quando disponível e pode ser colocado na faixa B-ROLL. No Autopilot vertical, a opção “Incorporar B-roll no MP4” também pode colocar automaticamente as mídias escolhidas dentro do vídeo final. Se uma fonte externa falhar, o render principal continua.</p>
        </section>
        <section>
          <h2>10. Timeline profissional multicamada</h2>
          <p>A timeline possui faixas separadas para VÍDEO, B-ROLL, TEXTO, ÁUDIO e ZOOM/FX. Clique em um item para selecionar, ajuste IN/OUT, arraste blocos desbloqueados para mudar o tempo, adicione textos e mova o playhead pelo ruler.</p>
        </section>
        <section>
          <h2>11. Autopilot</h2>
          <p>Escolha Podcast, Storytime, Gaming, Motivacional, Cinematic, Meme ou Satisfying. Ative ou desative transcrição, remoção de silêncios, 9:16, Auto Zoom e B-roll. “EXECUTAR AUTOPILOT” prepara o plano editável, gera o pacote social, procura B-roll licenciado quando ativado e renderiza o MP4. As decisões continuam visíveis na timeline para revisão.</p>
        </section>
        <section>
          <h2>12. Criar com IA · Fruit AI</h2>
          <p>Digite o conceito e use “Gerar storyboard IA”. O modo local cria cenas e, como fallback sem serviço pago de geração visual, monta um vídeo vertical animado usando mídia licenciada encontrada no Wikimedia Commons. Isso é diferente de gerar uma imagem/vídeo sintético fotorrealista do zero.</p>
        </section>
        <section>
          <h2>13. STORYVERSE</h2>
          <p>Abra STORYVERSE para criar séries, personagens e episódios em continuidade. Os dados ficam salvos localmente e podem ser exportados em TXT/JSON.</p>
        </section>
        <section>
          <h2>14. Login e sincronização</h2>
          <p>Magic Link e Supabase continuam opcionais para dados do projeto. As operações pesadas do editor e do Studio Pro foram desenhadas como local-first.</p>
        </section>

        <section className="guide-warning">
          <h2>Limites atuais que o TikCut mostra sem fingir</h2>
          <p>Geração visual sintética fotorrealista de imagem/vídeo ainda precisa de um provedor de geração dedicado. A disponibilidade da IA nativa do Chrome varia por navegador e aparelho. O TikCut sempre indica fallback e não promete viralização. Revise cortes, mídia, licenças, legendas, áudio e resultado final antes de publicar.</p>
        </section>
      </main>
    </div>
  );
}
