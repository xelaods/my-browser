// ここを書き換えれば、ブラウザを自由にカスタマイズできます
module.exports = {
  // サイドパネルで開けるAI（name と url を足せば好きなAIを追加できます）
  ai: [
    { name: 'Claude', url: 'https://claude.ai/new' },
    { name: 'ChatGPT', url: 'https://chatgpt.com/' },
    { name: 'Gemini', url: 'https://gemini.google.com/app' },
  ],

  // ワンクリックで送る指示（label がボタン名、text がAIへの指示文）。画面の言語ごとに ja / en
  prompts: {
    ja: [
      { label: '要約', text: '次のWebページの内容を日本語で簡潔に要約してください。' },
      { label: '要点', text: '次のWebページの要点を箇条書きで5つ挙げてください。' },
      { label: '翻訳', text: '次のWebページの内容を自然な日本語に翻訳してください。' },
      { label: '解説', text: '次のWebページの内容を、専門知識がない人にもわかるように解説してください。' },
    ],
    en: [
      { label: 'Summarize', text: 'Summarize the following web page concisely in English.' },
      { label: 'Key points', text: 'List the 5 key points of the following web page as bullet points.' },
      { label: 'Translate', text: 'Translate the content of the following web page into natural English.' },
      { label: 'Explain', text: 'Explain the following web page so that someone without background knowledge can understand it.' },
    ],
  },

  // 見た目のサイズ（px）
  sidebarWidth: 250, // 左の縦タブバーの幅
  aiWidth: 420,      // 右のAIパネルの幅

  // AIに渡す本文の最大文字数（長すぎるとAI側で弾かれることがあります）
  maxChars: 30000,

  // AIサイトの入力欄を探すためのセレクタ（AIのサイト改修で効かなくなったらここを調整）
  inputSelector: 'div[contenteditable="true"], textarea',

  // Googleアカウントでのログインが「安全でないブラウザ」と弾かれるのを回避する
  googleLoginFix: true,
};
