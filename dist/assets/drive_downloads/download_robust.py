import urllib.request
import os
import sys
import re
from urllib.parse import urlencode

def download_file_from_drive(file_id, dest_path, chunk_size=1024*1024):
    """
    Descarga un archivo grande desde Google Drive usando chunks para evitar MemoryError
    e intentando resolver la confirmación de advertencia de virus de forma dinámica.
    """
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    
    url = f"https://docs.google.com/uc?export=download&id={file_id}"
    user_agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    
    headers = {'User-Agent': user_agent}
    req = urllib.request.Request(url, headers=headers)
    
    try:
        print(f"Conectando a Google Drive para ID {file_id}...")
        with urllib.request.urlopen(req, timeout=30) as response:
            # Leer el inicio del contenido para ver si es HTML (página de confirmación) o descarga directa
            content_type = response.headers.get('Content-Type', '')
            if 'text/html' in content_type:
                html = response.read().decode('utf-8', errors='ignore')
                print("Detectada página de confirmación de Google Drive. Extrayendo parámetros...")
                
                # Buscar el formulario de descarga
                form_match = re.search(r'<form id="download-form" action="([^"]+)" method="get">', html)
                if not form_match:
                    # Alternativa: ver si hay algún link con confirm
                    confirm_match = re.search(r'confirm=([a-zA-Z0-9_\-]+)', html)
                    if confirm_match:
                        confirm_token = confirm_match.group(1)
                        download_url = f"https://drive.google.com/uc?export=download&confirm={confirm_token}&id={file_id}"
                    else:
                        print("No se pudo parsear la confirmación en el HTML. Mostrando primeras líneas:")
                        print(html[:1000])
                        return False
                else:
                    action_url = form_match.group(1)
                    # Extraer parámetros
                    inputs = re.findall(r'<input[^>]+type="hidden"[^>]*>', html)
                    params = {}
                    for inp in inputs:
                        name_match = re.search(r'name="([^"]+)"', inp)
                        value_match = re.search(r'value="([^"]+)"', inp)
                        if name_match and value_match:
                            params[name_match.group(1)] = value_match.group(1)
                    
                    # Forzar confirm=t si no está
                    if 'confirm' not in params:
                        params['confirm'] = 't'
                    params['id'] = file_id
                    
                    query_string = urlencode(params)
                    download_url = f"{action_url}?{query_string}"
                
                print(f"URL de descarga resuelta: {download_url}")
                req_download = urllib.request.Request(download_url, headers=headers)
            else:
                # Descarga directa
                print("Descarga directa detectada.")
                req_download = req
        
        # Realizar la descarga en fragmentos
        print(f"Iniciando descarga en chunks de {chunk_size/1024/1024:.1f}MB a {dest_path}...")
        with urllib.request.urlopen(req_download, timeout=30) as response_dl, open(dest_path, 'wb') as out_file:
            total_read = 0
            while True:
                chunk = response_dl.read(chunk_size)
                if not chunk:
                    break
                out_file.write(chunk)
                total_read += len(chunk)
                # Imprimir progreso simplificado cada 10MB
                if total_read % (10*1024*1024) < chunk_size:
                    print(f"Descargados {total_read / (1024*1024):.1f} MB...")
            
        print(f"¡Descarga exitosa de {dest_path}! Total: {total_read / (1024*1024):.1f} MB.")
        return True
        
    except Exception as e:
        print(f"Error descargando ID {file_id}: {e}")
        return False

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Uso: python download_robust.py <file_id> <dest_path>")
        sys.exit(1)
        
    file_id = sys.argv[1]
    dest_path = sys.argv[2]
    success = download_file_from_drive(file_id, dest_path)
    sys.exit(0 if success else 1)
