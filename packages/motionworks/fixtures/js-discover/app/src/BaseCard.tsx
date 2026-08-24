// Plain component with no motion — the factory target. Must NOT be reported.
export default function BaseCard(props: { children?: unknown }) {
  return <div className="card">{props.children as never}</div>;
}
