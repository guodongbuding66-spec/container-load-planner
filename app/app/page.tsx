import { PackingApp } from "../../components/packing-app";
import { TransportAppearanceProvider } from "../../components/transport-appearance";

export default function AppWorkbenchPage() {
  return (
    <TransportAppearanceProvider>
      <PackingApp />
    </TransportAppearanceProvider>
  );
}
