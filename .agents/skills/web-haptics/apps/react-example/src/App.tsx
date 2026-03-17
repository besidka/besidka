import { useWebHaptics } from "web-haptics/react";

export default function App() {
  const { trigger } = useWebHaptics();

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100vh",
        fontSize: "2rem",
      }}
    >
      <button onClick={() => trigger()}>Tap me</button>
    </div>
  );
}
