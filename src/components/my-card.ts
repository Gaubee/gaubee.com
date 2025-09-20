import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('my-card')
export class MyCard extends LitElement {
  @property({ type: String })
  title = '';

  @property({ type: String })
  href = '';

  @property({ type: String })
  type = '';

  @property({ type: String })
  date = '';

  static styles = css`
    :host {
      display: block;
      border: 1px solid #ccc;
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 1rem;
      transition: box-shadow 0.2s ease-in-out;
    }
    :host(:hover) {
      box-shadow: 0 4px 8px rgba(0,0,0,0.1);
    }
    a {
      text-decoration: none;
      color: inherit;
    }
    h3 {
      margin-top: 0;
      font-size: 1.25rem;
    }
    p {
      margin: 0.25rem 0;
      font-size: 0.9rem;
      color: #555;
    }
  `;

  render() {
    return html`
      <a href=${this.href}>
        <h3>${this.title}</h3>
        <p>Type: ${this.type}</p>
        <p>Date: ${this.date}</p>
      </a>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'my-card': MyCard;
  }
}
