import { Link } from 'react-router-dom';

export function Card({ items, label }: { items: string[]; label: string }) {
  return (
    <div className="card">
      <img src="/hero.png" />
      <div onClick={() => alert('hi')}>Open</div>
      <input type="text" placeholder="Search" />
      <button><svg aria-hidden="true" /></button>
      <a href="/docs">click here</a>
      <label htmlFor="email">Email</label>
      <input id="email" type="email" autoComplete="email" />
      <button>{label}</button>
      <span tabIndex={2}>focus me</span>
      <p className="text-gray-400 bg-white">Low contrast</p>
      {items.map((i) => <img key={i} src={i} alt="" />)}
      <Link to="/home"></Link>
    </div>
  );
}
