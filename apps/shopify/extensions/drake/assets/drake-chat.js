/* Deep Chat renders the transcript; Drake retains transport, audio and commerce. */
(function () {
  "use strict";
  const blocks = new Map();
  const blockStyle = `
    :host{display:block;color:#f1f2ff;font:inherit;max-width:100%} *{box-sizing:border-box}
    .drake-cards{display:grid;gap:.7rem}.drake-card,.drake-proposal{border:1px solid #39425e;border-radius:.8rem;background:#192033;padding:.75rem;color:#f1f2ff}
    .drake-card__image{width:100%;max-height:190px;object-fit:contain;background:#fff;border-radius:.5rem}
    .drake-card__title{color:#f1f2ff;font-size:.95rem;margin:.5rem 0}.drake-card__variant,.drake-card__reason{color:#b6bfd6;font-size:.8rem;margin:.3rem 0}
    button,select,input{font:inherit;border-radius:.4rem;padding:.45rem;border:1px solid #a38ce1;background:#242b48;color:#fff;max-width:100%}
    button{cursor:pointer}button:disabled{opacity:.5;cursor:default}a{color:#89e2f3;margin-left:.5rem}.drake-card__selection{display:grid;gap:.5rem;margin-top:.5rem}
    [hidden]{display:none!important}label{display:flex;align-items:center;gap:.5rem;margin:.4rem 0}input{width:5rem}.drake-proposal__controls{display:flex;flex-wrap:wrap;gap:.5rem}
    button:focus-visible,select:focus-visible,input:focus-visible,a:focus-visible{outline:2px solid #ffbf59;outline-offset:2px}
  `;
  if (!customElements.get('ishop-drake-block')) customElements.define('ishop-drake-block', class extends HTMLElement {
    connectedCallback() {
      const node = blocks.get(this.dataset.key);
      if (!node) return;
      const shadow = this.shadowRoot || this.attachShadow({mode: 'open'});
      const style = document.createElement('style'); style.textContent = blockStyle;
      shadow.replaceChildren(style, node);
    }
  });
  class Transcript {
    constructor(container) {
      this.view = document.createElement('deep-chat');
      this.view.className = 'drake-chat';
      this.view.setAttribute('aria-label', 'Conversation with Drake');
      this.view.chatStyle = {width:'100%',height:'100%',border:'0',backgroundColor:'transparent',fontFamily:'inherit',fontSize:'14px'};
      this.view.inputAreaStyle = {display:'none'};
      this.view.textInput = {disabled:true};
      this.view.remarkable = {html:false};
      this.view.maxVisibleMessages = 64;
      this.view.messageStyles = {default:{shared:{bubble:{backgroundColor:'#242b40',color:'#f1f2ff',borderRadius:'14px',fontSize:'14px',maxWidth:'94%'}},user:{bubble:{backgroundColor:'#663fc0',color:'#fff'}}},html:{shared:{bubble:{backgroundColor:'transparent',padding:'0',width:'100%',maxWidth:'100%'}}}};
      this.view.auxiliaryStyle = '.html-message{width:100%} #messages{padding:8px} img{max-height:220px;object-fit:contain}';
      this.view.connect = {handler: async (_body, signals) => signals.onClose()};
      this.pending = [];
      this.ready = false;
      this.keys = new Set();
      this.view.onComponentRender = () => {
        this.ready = true;
        for (const message of this.pending.splice(0)) this.view.addMessage(message);
      };
      container.prepend(this.view);
    }
    add(entry) {
      const message = {role: entry.role === 'shopper' ? 'user' : 'ai', text: String(entry.text || '')};
      if (entry.attachment && /^data:image\/(?:jpeg|png|webp);base64,/.test(entry.attachment)) {
        message.files = [{src:entry.attachment,type:'image',name:'Uploaded product photo'}];
      }
      this.push(message);
    }
    push(message) {
      if (this.ready) this.view.addMessage(message); else this.pending.push(message);
    }
    addBlock(node) {
      const key = crypto.randomUUID(); blocks.set(key,node); this.keys.add(key);
      if (this.keys.size > 64) { const oldest = this.keys.values().next().value; this.keys.delete(oldest); blocks.delete(oldest); }
      // Only application-generated identifiers are interpolated, never model HTML.
      this.push({role:'ai',html:`<ishop-drake-block data-key="${key}"></ishop-drake-block>`});
      return key;
    }
    scrollToBottom() { if (this.ready) this.view.scrollToBottom(); }
  }
  window.IShopChat = {Transcript};
})();
