import os
from PIL import Image

def process_image(filename):
    path = os.path.join(r"c:\Users\Usuario\Documents\Calude\mirada\Pagina Estar\pagina web\assets", filename)
    if not os.path.exists(path):
        print(f"File {path} does not exist.")
        return
    
    img = Image.open(path)
    print(f"\nProcessing {filename}:")
    print(f"Size: {img.size}, Format: {img.format}, Mode: {img.mode}")
    
    # Check if there is alpha channel
    has_alpha = 'A' in img.mode or img.info.get('transparency') is not None
    print(f"Has alpha/transparency: {has_alpha}")
    
    # Convert to RGBA
    rgba = img.convert("RGBA")
    data = rgba.getdata()
    
    # Analyze corner color to identify potential background color
    corners = [data[0], data[img.width-1], data[(img.height-1)*img.width], data[img.width*img.height-1]]
    print(f"Corner colors (RGBA): {corners}")
    
    # If it is solid, let's make it transparent.
    # The user says "recortar la imagen que tenga fondo vacio y que sea mas grande"
    # Let's find the background color (most common color near corners, or just the exact corner color)
    bg_color = corners[0]
    
    # We will build a new image where colors close to bg_color are transparent
    new_data = []
    # Threshold for color matching
    threshold = 30
    
    for item in data:
        # Calculate distance to background color
        r_diff = abs(item[0] - bg_color[0])
        g_diff = abs(item[1] - bg_color[1])
        b_diff = abs(item[2] - bg_color[2])
        
        if r_diff < threshold and g_diff < threshold and b_diff < threshold:
            # Make transparent
            new_data.append((0, 0, 0, 0))
        else:
            # Keep original pixel, but if it was olive, let's keep it or make it white/charcoal as needed
            new_data.append(item)
            
    rgba.putdata(new_data)
    
    # Crop to bounding box of non-transparent pixels
    bbox = rgba.getbbox()
    if bbox:
        cropped = rgba.crop(bbox)
        print(f"Cropped bbox: {bbox}, New size: {cropped.size}")
        # Save processed transparent image
        output_path = os.path.join(r"c:\Users\Usuario\Documents\Calude\mirada\Pagina Estar\pagina web\assets", "transparent_" + filename)
        cropped.save(output_path, "PNG")
        print(f"Saved transparent version to: {output_path}")
    else:
        print("Could not detect bounding box (image might be fully transparent).")

process_image("icon-star-on-olive.png")
process_image("icon-star-charcoal.png")
process_image("icon-star-taupe.png")
