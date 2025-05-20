document.addEventListener('DOMContentLoaded', function() {
    // DOM elements
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
    const messagesContainer = document.getElementById('chat-messages');
    
    if (!messageForm) return; // Exit if no message form found
    
    // Save original submit handler
    const originalSubmitHandler = messageForm.onsubmit;
    
    // Remove required attribute from message input to allow image-only messages
    if (messageInput) {
        messageInput.removeAttribute('required');
    }
    
    // Add file input for image uploads
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'image-upload';
    fileInput.name = 'attachment';
    fileInput.accept = 'image/*'; // Accept only image files
    fileInput.style.display = 'none'; // Hide the default file input
    
    // Create custom image upload button with icon
    const uploadButton = document.createElement('button');
    uploadButton.type = 'button';
    uploadButton.className = 'btn btn-light btn-sm me-2';
    uploadButton.title = 'Upload Image';
    uploadButton.innerHTML = '<i class="bi bi-image"></i>';
    
    // Create preview container for selected image
    const previewContainer = document.createElement('div');
    previewContainer.id = 'image-preview-container';
    previewContainer.className = 'image-preview-container mt-2 mb-2 d-none';
    previewContainer.innerHTML = `
        <div class="position-relative d-inline-block">
            <img id="image-preview" class="rounded border" style="max-height: 120px; max-width: 200px; object-fit: contain;">
            <button type="button" id="remove-image" class="btn btn-sm btn-danger position-absolute" style="top: -10px; right: -10px; border-radius: 50%; width: 24px; height: 24px; padding: 0;">
                <i class="bi bi-x"></i>
            </button>
        </div>
    `;
    
    // Insert elements into the DOM - first add the file input to the form
    messageForm.insertBefore(fileInput, messageForm.firstChild);
    
    // Adjust the form structure to include the upload button
    if (messageForm.classList.contains('d-flex')) {
        // If form already has d-flex, just insert the upload button
        const submitButton = messageForm.querySelector('button[type="submit"]');
        if (submitButton) {
            messageForm.insertBefore(uploadButton, submitButton);
        }
    } else {
        // Convert to input group structure
        const inputGroup = document.createElement('div');
        inputGroup.className = 'input-group';
        
        // Move existing input to the group
        if (messageInput) {
            messageInput.parentNode.insertBefore(inputGroup, messageInput);
            inputGroup.appendChild(messageInput);
        }
        
        // Add upload button to the input group
        inputGroup.appendChild(uploadButton);
        
        // Move submit button to the input group
        const submitButton = messageForm.querySelector('button[type="submit"]');
        if (submitButton) {
            inputGroup.appendChild(submitButton);
        }
        
        // Add preview container after the input group
        messageForm.appendChild(previewContainer);
    }
    
    // Add click event to trigger file input
    uploadButton.addEventListener('click', function() {
        fileInput.click();
    });
    
    // Handle file selection
    fileInput.addEventListener('change', function(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        // Validate file type and size
        if (!file.type.match('image.*')) {
            alert('Please select an image file.');
            fileInput.value = '';
            return;
        }
        
        if (file.size > 5 * 1024 * 1024) { // 5MB limit
            alert('Image file size must be less than 5MB.');
            fileInput.value = '';
            return;
        }
        
        // Display preview
        const reader = new FileReader();
        reader.onload = function(e) {
            const preview = document.getElementById('image-preview');
            if (preview) {
                preview.src = e.target.result;
                previewContainer.classList.remove('d-none');
            }
        };
        reader.readAsDataURL(file);
    });
    
    // Handle remove image button
    const removeButton = document.getElementById('remove-image');
    if (removeButton) {
        removeButton.addEventListener('click', function() {
            fileInput.value = '';
            previewContainer.classList.add('d-none');
        });
    }
    
    // Override the form submission to handle image uploads
    messageForm.onsubmit = function(e) {
        e.preventDefault();
        
        const message = messageInput.value.trim();
        const file = fileInput.files[0];
        
        // Don't submit if neither message nor file is provided
        if (!message && !file) {
            return;
        }
        
        // Disable the form to prevent double submission
        const submitButton = this.querySelector('button[type="submit"]');
        if (submitButton) submitButton.disabled = true;
        
        // Show a temporary message
        const tempMessage = document.createElement('div');
        tempMessage.classList.add('message', 'message-outgoing', 'temp-message');
        let tempContent = '';
        
        if (message) {
            tempContent += `<div class="message-content">${message}</div>`;
        }
        
        if (file) {
            tempContent += `${message ? '' : ''}
            <div class="image-uploading mt-2">
                <i class="bi bi-cloud-upload"></i> Uploading image...
            </div>`;
        }
        
        tempContent += `<div class="read-status unread">Sending...</div>`;
        tempMessage.innerHTML = tempContent;
        
        messagesContainer.appendChild(tempMessage);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        // Create FormData object to handle file upload
        const formData = new FormData();
        
        // Add conversation ID from the form's data attribute or from the URL
        const conversationId = messageForm.dataset.conversationId || 
                              window.location.search.split('provider=')[1];
                              
        formData.append('conversationId', conversationId);
        
        if (message) {
            formData.append('message', message);
        }
        
        if (file) {
            formData.append('attachment', file);
        }
        
        // Send via fetch API
        fetch('/api/send-message', {
            method: 'POST',
            body: formData,
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`Server responded with status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            // Remove temporary message
            const tempMessages = document.querySelectorAll('.temp-message');
            tempMessages.forEach(el => messagesContainer.removeChild(el));
            
            if (data.success) {
                // Add the confirmed message
                if (typeof window.addMessage === 'function') {
                    window.addMessage(data.message, true);
                } else {
                    // Fallback if addMessage function is not defined
                    const messageElement = document.createElement('div');
                    messageElement.classList.add('message', 'message-outgoing');
                    
                    let messageContent = '';
                    if (data.message.message_text) {
                        messageContent += `<div class="message-content">${data.message.message_text}</div>`;
                    }
                    
                    if (data.message.has_attachment && data.message.attachment_url) {
                        const isImage = data.message.attachment_type && data.message.attachment_type.startsWith('image/');
                        if (isImage) {
                            messageContent += `
                                <div class="message-attachment mt-2">
                                    <a href="${data.message.attachment_url}" target="_blank">
                                        <img src="${data.message.attachment_url}" class="img-thumbnail message-image" alt="Image attachment">
                                    </a>
                                </div>
                            `;
                        } else {
                            messageContent += `
                                <div class="message-attachment mt-2">
                                    <a href="${data.message.attachment_url}" class="btn btn-sm btn-outline-secondary" target="_blank">
                                        <i class="bi bi-paperclip"></i> ${data.message.attachment_name || 'Attachment'}
                                    </a>
                                </div>
                            `;
                        }
                    }
                    
                    messageContent += `<div class="read-status unread">Delivered</div>`;
                    messageElement.innerHTML = messageContent;
                    
                    messagesContainer.appendChild(messageElement);
                    messagesContainer.scrollTop = messagesContainer.scrollHeight;
                }
                
                // Clear inputs
                messageInput.value = '';
                fileInput.value = '';
                previewContainer.classList.add('d-none');
                
                // Try to emit via Socket.IO if available
                try {
                    if (typeof socket !== 'undefined' && socket.connected) {
                        socket.emit('send-message', {
                            conversationId: conversationId,
                            message: data.message
                        });
                    }
                } catch (socketError) {
                    console.error('Socket.IO error:', socketError);
                }
            } else {
                alert('Failed to send message: ' + (data.error || 'Unknown error'));
            }
        })
        .catch(error => {
            console.error('Fetch error:', error);
            
            // Find and remove the temporary message
            const tempMessages = document.querySelectorAll('.temp-message');
            tempMessages.forEach(el => {
                try {
                    messagesContainer.removeChild(el);
                } catch (err) {
                    console.warn('Could not remove temp message:', err);
                }
            });
            
            // Show error
            alert('Failed to send message. Please try again.');
        })
        .finally(() => {
            // Re-enable the form
            if (submitButton) submitButton.disabled = false;
        });
    };
});