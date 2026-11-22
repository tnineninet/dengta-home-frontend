function hasImageFiles(files) {
    return (Array.isArray(files) ? files : []).some((file) =>
        String(file?.mimetype || file?.mimeType || "").startsWith("image/")
    );
}

module.exports = { hasImageFiles };
