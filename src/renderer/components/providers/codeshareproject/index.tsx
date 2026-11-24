import { Link2 } from "lucide-react";
import { registerProviderIcon } from "../ProviderIcon";
import manifest from "./manifest";

registerProviderIcon(manifest.kind, ({ className }) => <Link2 className={className} />);
