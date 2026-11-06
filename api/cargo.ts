import { CLOUD_ORIGINS } from "../lib/cloud/protocol.ts";
import { deploymentCloud } from "../lib/cloud/runtime.ts";
import { cloudRequest, cloudRoute } from "../lib/cloud/service.ts";

const cargoHandler = {
  fetch(request: Request) {
    const route = cloudRoute(new URL(request.url));
    return cloudRequest(request, route, deploymentCloud(), CLOUD_ORIGINS);
  },
};

export default cargoHandler;
