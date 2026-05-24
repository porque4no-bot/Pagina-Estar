import os
from PIL import Image

def process_and_overwrite(filename):
    path = os.path.join(r"c:\Users\Usuario\Documents\Calude\mirada\Pagina Estar\pagina web\assets", filename)
    if not os.path.exists(path):
        print(f"File {path} does not exist.")
        return
    
    img = Image.open(path)
    print(f"\nProcessing {filename}:")
    print(f"Original Size: {img.size}, Mode: {img.mode}")
    
    # Convert to RGBA
    rgba = img.convert("RGBA")
    data = rgba.getdata()
    
    # Identify background color from corner
    bg_color = data[0]
    has_alpha = 'A' in img.mode or img.info.get('transparency') is not None
    
    # If the image does not have real alpha (or has solid corners), make the background transparent
    new_data = []
    # If the corner is transparent, we don't need to do color replacement for transparency
    is_corner_transparent = bg_color[3] == 0
    
    if not is_corner_transparent:
        print(f"Corner color {bg_color} is solid. Making background transparent.")
        # Threshold for background color
        threshold = 30
        for item in data:
            r_diff = abs(item[0] - bg_color[0])
            g_diff = abs(item[1] - bg_color[1])
            b_diff = abs(item[2] - bg_color[2])
            
            if r_diff < threshold and g_diff < threshold and b_diff < threshold:
                new_data.append((0, 0, 0, 0)) # Make background transparent
            else:
                new_data.append(item) # Keep original star color (which should be white or similar)
        rgba.putdata(new_data)
    else:
        print("Corner is already transparent. Keeping existing transparency.")
    
    # Find bounding box
    bbox = rgba.getbbox()
    if bbox:
        # Crop the image to bounds
        cropped = rgba.crop(bbox)
        print(f"Cropping from {img.size} to bounding box {bbox} (new size: {cropped.size})")
        
        # Save back to the original file path as PNG
        # Note: Pillow save will overwrite the file.
        # We also want to make sure it's saved with correct transparency.
        cropped.save(path, "PNG")
        print(f"Successfully overwrote {filename} with cropped transparent version!")
    else:
        print(f"Error: bbox was none for {filename}")

# Run process for all three star files
process_and_overwrite("icon-star-on-olive.png")
process_and_overwrite("icon-star-charcoal.png")
process_and_overwrite("icon-star-taupe.png")
