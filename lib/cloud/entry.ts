import { CLOUD_ORIGINS } from "./protocol.ts";
import { deploymentCloud } from "./runtime.ts";
import { cloudRequest, cloudRoute } from "./service.ts";

const cargoHandler = {
  fetch(request: Request) {
    const route = cloudRoute(new URL(request.url));
    return cloudRequest(request, route, deploymentCloud(), CLOUD_ORIGINS);
  },
};

export default cargoHandler;
