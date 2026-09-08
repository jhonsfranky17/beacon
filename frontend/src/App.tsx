import { USER_ROLES } from "@beacon/shared";

export function App(): React.JSX.Element {
  return (
    <main>
      <h1>Beacon</h1>
      <p>Foundations phase — scaffold check.</p>
      <p>Known roles: {USER_ROLES.join(", ")}</p>
    </main>
  );
}
