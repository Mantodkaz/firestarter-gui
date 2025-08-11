from PIL import Image

src = r"src-tauri/icons/firestarter.png"
dst = r"src-tauri/icons/firestarter-square.png"

img = Image.open(src)
size = max(img.size)  # ambil sisi terpanjang
new_img = Image.new("RGBA", (size, size), (255, 255, 255, 0))
new_img.paste(img, ((size - img.width) // 2, (size - img.height) // 2))
new_img = new_img.resize((1024, 1024))
new_img.save(dst)

print(f"Saved square icon as {dst}")
