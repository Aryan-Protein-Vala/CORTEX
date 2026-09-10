import os
import requests
from typing import Dict, Any, Optional

class Cortex:
    """
    Cortex SDK for resolving and injecting graph memory via the cortex:// protocol.
    """
    def __init__(self, api_key: str, base_url: Optional[str] = None):
        self.api_key = api_key
        self.base_url = (base_url or os.getenv('CORTEX_API_URL', 'http://localhost:3030')).rstrip('/')

    def get_graph(self, uri: str, include_mesh: bool = False) -> Dict[str, Any]:
        """
        Fetches the context graph for a given user or team via the custom protocol
        """
        if not uri.startswith('cortex://'):
            raise ValueError("Invalid Cortex URI. Must start with 'cortex://'")

        headers = {
            'Authorization': f'Bearer {self.api_key}',
            'Content-Type': 'application/json'
        }
        
        params = {"uri": uri}
        if include_mesh:
            params["include_mesh"] = "true"

        response = requests.get(f"{self.base_url}/v1/resolve", params=params, headers=headers)
        response.raise_for_status()
        
        return response.json()

    def inject_memory(self, uri: str, text: str) -> bool:
        """
        Injects new memory into a user's graph
        """
        if not uri.startswith('cortex://'):
            raise ValueError("Invalid Cortex URI. Must start with 'cortex://'")

        headers = {
            'Authorization': f'Bearer {self.api_key}',
            'Content-Type': 'application/json'
        }
        
        data = {
            "uri": uri,
            "text": text
        }
        
        response = requests.post(f"{self.base_url}/v1/inject", json=data, headers=headers)
        response.raise_for_status()
        
        return True

    def publish_to_mesh(self, nodes: list, edges: list) -> bool:
        """
        Publishes local nodes and edges to the decentralized Global Mesh (cortex://global)
        """
        headers = {
            'Authorization': f'Bearer {self.api_key}',
            'Content-Type': 'application/json'
        }
        
        data = {
            "nodes": nodes,
            "edges": edges
        }
        
        response = requests.post(f"{self.base_url}/v1/mesh/publish", json=data, headers=headers)
        response.raise_for_status()
        
        return True
