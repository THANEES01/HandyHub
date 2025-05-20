document.addEventListener('DOMContentLoaded', function() {
    // Create lightbox container
    const lightbox = document.createElement('div');
    lightbox.className = 'image-lightbox';
    lightbox.innerHTML = `
        <div class="lightbox-content">
            <img src="" alt="Full size image" class="lightbox-image">
            <div class="lightbox-close"><i class="bi bi-x-lg"></i></div>
        </div>
    `;
    document.body.appendChild(lightbox);
    
    // Get DOM elements
    const lightboxImage = lightbox.querySelector('.lightbox-image');
    const lightboxClose = lightbox.querySelector('.lightbox-close');
    
    // Close lightbox when clicking the close button
    lightboxClose.addEventListener('click', function() {
        lightbox.classList.remove('active');
    });
    
    // Close lightbox when clicking outside the image
    lightbox.addEventListener('click', function(e) {
        if (e.target === lightbox) {
            lightbox.classList.remove('active');
        }
    });
    
    // Add escape key to close lightbox
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && lightbox.classList.contains('active')) {
            lightbox.classList.remove('active');
        }
    });
    
    // Delegate click handler for message images
    document.addEventListener('click', function(e) {
        // Find closest message-image if clicked on or within one
        const messageImage = e.target.closest('.message-image');
        
        if (messageImage) {
            // Get the full-size image URL
            const imageUrl = messageImage.src;
            
            // Set lightbox image source
            lightboxImage.src = imageUrl;
            
            // Show lightbox
            lightbox.classList.add('active');
            
            // Prevent default behavior if it's within an <a> tag
            e.preventDefault();
        }
    });
});