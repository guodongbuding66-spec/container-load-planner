import { PackingApp } from "../components/packing-app";
import { TransportAppearanceProvider } from "../components/transport-appearance";

export default function Home() {
  return <TransportAppearanceProvider><PackingApp /></TransportAppearanceProvider>;
}
