import './components/my-card.js';
import './components/mix-blend-mode-gradient-text.js';
import './components/youtube-player.js';
import type { MyCard } from './components/my-card.js';

interface ContentItem {
  title: string;
  date: string;
  path: string;
  type: 'article' | 'event';
}

async function loadFeed() {
  const feedContainer = document.getElementById('feed-container');
  if (!feedContainer) {
    console.error('Feed container not found!');
    return;
  }

  try {
    const response = await fetch('/content.json');
    if (!response.ok) {
      throw new Error(`Failed to fetch content.json: ${response.statusText}`);
    }
    const items: ContentItem[] = await response.json();

    items.forEach(item => {
      const card = document.createElement('my-card') as MyCard;
      card.title = item.title;
      card.href = `.${item.path}`; // Use relative path for the link
      card.type = item.type;
      card.date = new Date(item.date).toLocaleDateString();
      feedContainer.appendChild(card);
    });

  } catch (error) {
    console.error('Error loading feed:', error);
    feedContainer.innerHTML = '<p>Could not load content feed. Please try again later.</p>';
  }
}

loadFeed();
