"""
CargoFit Official Python SDK (v2.2.0)
Connects ERP / WMS / TMS / Python data pipelines to CargoFit REST API or local MCP Server.
"""
from __future__ import annotations

import json
import urllib.request
from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Optional


@dataclass
class CargoItem:
    sku: str
    lengthMm: int
    widthMm: int
    heightMm: int
    weightKg: float
    quantity: int
    name: Optional[str] = None
    rotationPolicy: str = "upright"
    stackable: bool = True
    maxStackLayers: int = 0


class CargoFitClient:
    """Lightweight zero-dependency Python client for CargoFit Container Load Planner."""

    def __init__(self, base_url: str, api_key: Optional[str] = None, timeout_sec: int = 30) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout_sec = timeout_sec

    def calculate_plan(
        self,
        container_id: str,
        products: List[CargoItem],
        strategy: str = "practical",
        mode: str = "mixed",
        clearance_mm: int = 10,
    ) -> Dict[str, Any]:
        payload = {
            "schema": "cargo-fit-api-v1.8",
            "containerId": container_id,
            "strategy": strategy,
            "mode": mode,
            "clearanceMm": clearance_mm,
            "products": [asdict(p) for p in products],
        }
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        req = urllib.request.Request(
            f"{self.base_url}/api/v1/plan",
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=self.timeout_sec) as resp:
            return json.loads(resp.read().decode("utf-8"))
