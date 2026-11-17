import * as THREE from "three";
import { calculateCameraDirectionFit, type SceneSize } from "./camera-fit";
import { TRANSPORT_COLORS, type TransportPart } from "./transport-model";
import { packagingFaceUV, type PackagingMaterial } from "./packaging-materials";

/** CPU projection of the same exterior parts, used only when WebGL is unavailable. */
export function projectModelPreview(parts: TransportPart[], bounds: { size: SceneSize; origin: SceneSize }, direction: SceneSize, width = 520, height = 260, material?: PackagingMaterial) {
  const unit = new THREE.Vector3(...direction).normalize();
  const up: SceneSize = Math.abs(unit.y) > .9999 ? [0, 0, -1] : [0, 1, 0];
  const fit = calculateCameraDirectionFit(bounds.size, { width, height }, direction, up);
  const camera = new THREE.OrthographicCamera(-fit.orthographicHalfWidth, fit.orthographicHalfWidth, fit.orthographicHalfHeight, -fit.orthographicHalfHeight, fit.near, fit.far);
  camera.position.fromArray(fit.position).add(new THREE.Vector3(...bounds.origin));
  camera.up.fromArray(up);
  camera.lookAt(new THREE.Vector3(...fit.target).add(new THREE.Vector3(...bounds.origin)));
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  const project = (point: SceneSize) => { const p = new THREE.Vector3(...point).project(camera); return { x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2, depth: p.z }; };
  const faces: { id: string; points: string; color: string; depth: number; name: string; texture?: { end: boolean; transform: string } }[] = [];
  const boxFaces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [0, 1, 5, 4], [3, 7, 6, 2]];
  parts.forEach((part, index) => {
    let vertices: THREE.Vector3[], polygons: number[][];
    if (part.shape === "wheel") {
      vertices = [-1, 1].flatMap(side => Array.from({length:12},(_,i)=>new THREE.Vector3(Math.cos(i*Math.PI/6)*part.size[0]/2,Math.sin(i*Math.PI/6)*part.size[1]/2,side*part.size[2]/2)));
      polygons = [Array.from({length:12},(_,i)=>11-i),Array.from({length:12},(_,i)=>i+12),...Array.from({length:12},(_,i)=>[i,(i+1)%12,(i+1)%12+12,i+12])];
    } else {
      vertices = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(v=>new THREE.Vector3(...v.map((n,i)=>n*part.size[i]/2) as SceneSize));
      polygons = boxFaces;
    }
    vertices.forEach(v => v.add(new THREE.Vector3(...part.position)));
    polygons.forEach((polygon, faceIndex) => {
      const points = polygon.map(i=>vertices[i]);
      const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).normalize();
      const center = points.reduce((c,p)=>c.add(p),new THREE.Vector3()).multiplyScalar(1/points.length);
      if (normal.dot(camera.position.clone().sub(center)) <= 0) return;
      const projected = points.map(p=>project(p.toArray() as SceneSize));
      const light = .68 + .3*Math.max(0,normal.dot(new THREE.Vector3(.3,.8,.5).normalize()));
      const color = new THREE.Color(part.color??TRANSPORT_COLORS[part.role]).multiplyScalar(light);
      const texture = material && part.shape==="box" ? (() => {
        const n = normal.toArray().findIndex(x => Math.abs(x) > .99) as 0|1|2;
        const {u,v,tileU,tileV,surface}=packagingFaceUV(part.size,n,material);
        const origin=points[0].toArray() as SceneSize;
        const across=[...origin] as SceneSize, down=[...origin] as SceneSize;
        across[u]+=tileU; down[v]+=tileV;
        const p=project(origin), q=project(across), r=project(down);
        const tx=p.x+(q.x-p.x)*(index%5)*.17+(r.x-p.x)*(index%7)*.12;
        const ty=p.y+(q.y-p.y)*(index%5)*.17+(r.y-p.y)*(index%7)*.12;
        const transform=[q.x-p.x,q.y-p.y,r.x-p.x,r.y-p.y,tx,ty].map(value=>value.toFixed(4)).join(" ");
        return {end: surface==="end",transform:`matrix(${transform})`};
      })():undefined;
      faces.push({id:`${index}-${faceIndex}`,name:part.name,points:projected.map(p=>`${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" "),color:`#${color.getHexString()}`,depth:project(center.toArray() as SceneSize).depth,texture});
    });
  });
  faces.sort((a,b)=>b.depth-a.depth);
  return { faces, project, camera };
}
