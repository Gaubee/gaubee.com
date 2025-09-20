import React from 'react';
import './Card.css';

interface Props {
  href: string;
  title: string;
  date: string;
  type: 'article' | 'event';
}

const Card: React.FC<Props> = ({ href, title, date, type }) => {
  return (
    <li className="card-item">
      <a href={href}>
        <h2>
          {title}
          <span>&rarr;</span>
        </h2>
        <div className="card-meta">
          <p>
            <time dateTime={date}>{new Date(date).toLocaleDateString('en-us', {
						year: 'numeric',
						month: 'short',
						day: 'numeric',
					})}</time>
          </p>
          <p className={`card-type ${type}`}>{type}</p>
        </div>
      </a>
    </li>
  );
};

export default Card;
