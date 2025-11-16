// Chat input component custom element
class ChatInputComponent extends HTMLElement {
  constructor() {
    super();
    this.onSubmit = null;
    this.onResize = null;
    this.onFileUpload = null;
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
  }

  render() {
    const placeholder = this.getAttribute('placeholder') || 'Type a message...';
    const minHeight = this.getAttribute('min-height') || '32px';
    const maxHeight = this.getAttribute('max-height') || '150px';
    const rows = this.getAttribute('rows') || '1';
    const showFileUpload = this.getAttribute('show-file-upload') === 'true';

    this.innerHTML = `
        <div class="chat-input-wrapper" style="
          display: flex;
          align-items: flex-end;
          position: relative;
          width: 100%;
        ">
          <textarea 
            class="chat-input-textarea" 
            rows="${rows}" 
            placeholder="${placeholder}"
            style="
              flex: 1;
              min-height: ${minHeight};
              max-height: ${maxHeight};
              padding: 8px;
              ${showFileUpload ? 'padding-right: 40px;' : ''}
              border: 1px solid #ddd;
              border-radius: 4px;
              resize: none;
              overflow-y: auto;
              font-family: Arial, Helvetica, sans-serif;
              font-size: 16px;
              line-height: 1.2;
              outline: none;
              box-sizing: border-box;
            "
          ></textarea>
          ${
            showFileUpload
              ? `
            <input 
              type="file" 
              class="chat-input-file" 
              multiple
              style="display: none;"
            >
            <input 
              type="file" 
              class="chat-input-media" 
              accept="image/*,video/*"
              multiple
              capture
              style="display: none;"
            >
            <i 
              class="ri-add-circle-line chat-input-add-btn" 
              title="Add attachment"
              style="
                position: absolute;
                right: 8px;
                bottom: 6px;
                width: 24px;
                height: 24px;
                cursor: pointer;
                font-size: 24px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: color 0.2s;
                color: #666;
              "
            ></i>
            <div class="chat-input-menu" style="
              display: none;
              position: absolute;
              right: 0;
              bottom: 45px;
              background: white;
              border: 1px solid #ddd;
              border-radius: 8px;
              box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
              overflow: hidden;
              z-index: 1000;
              min-width: 180px;
            ">
              <div class="menu-item upload-file" style="
                width: 100%;
                padding: 12px 16px;
                cursor: pointer;
                text-align: left;
                font-size: 14px;
                display: flex;
                align-items: center;
                gap: 10px;
                transition: background 0.2s;
              ">
                <i class="ri-attachment-line" style="font-size: 18px; color: #666;"></i>
                <span>Upload File</span>
              </div>
              <div class="menu-item upload-media" style="
                width: 100%;
                padding: 12px 16px;
                cursor: pointer;
                text-align: left;
                font-size: 14px;
                display: flex;
                align-items: center;
                gap: 10px;
                transition: background 0.2s;
                border-top: 1px solid #f0f0f0;
              ">
                <i class="ri-image-line" style="font-size: 18px; color: #666;"></i>
                <span>Image/Video</span>
              </div>
            </div>
          `
              : ''
          }
        </div>
      `;

    this.textarea = this.querySelector('.chat-input-textarea');
    this.fileInput = this.querySelector('.chat-input-file');
    this.mediaInput = this.querySelector('.chat-input-media');
    this.addBtn = this.querySelector('.chat-input-add-btn');
    this.menu = this.querySelector('.chat-input-menu');
  }

  setupEventListeners() {
    if (!this.textarea) return;

    // Track composition state for IME input (Chinese, Japanese, etc.)
    let isComposing = false;

    this.textarea.addEventListener('compositionstart', () => {
      isComposing = true;
    });

    this.textarea.addEventListener('compositionend', () => {
      isComposing = false;
    });

    // Handle Enter key (submit on Enter, new line on Shift+Enter)
    // Check our own isComposing flag to avoid sending during IME composition
    this.textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !isComposing) {
        event.preventDefault();
        this.submit();
        return;
      }

      // Clear reply when ESC is pressed
      if (event.key === 'Escape' && currentReplyTo) {
        event.preventDefault();
        clearReplyTo();
        return;
      }
    });

    // Auto-resize on input
    this.textarea.addEventListener('input', () => {
      this.autoResize();
    });

    // Add button click - toggle menu
    if (this.addBtn && this.menu) {
      this.addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = this.menu.style.display === 'block';
        this.menu.style.display = isVisible ? 'none' : 'block';
      });

      // Add hover effect
      this.addBtn.addEventListener('mouseenter', () => {
        this.addBtn.style.color = '#333';
      });
      this.addBtn.addEventListener('mouseleave', () => {
        this.addBtn.style.color = '#666';
      });

      // Close menu when clicking outside
      document.addEventListener('click', (e) => {
        if (this.menu && !this.contains(e.target)) {
          this.menu.style.display = 'none';
        }
      });

      // Menu item: Upload File
      const uploadFileBtn = this.menu.querySelector('.upload-file');
      if (uploadFileBtn) {
        uploadFileBtn.addEventListener('click', () => {
          if (this.fileInput) {
            this.fileInput.click();
          }
          this.menu.style.display = 'none';
        });
        uploadFileBtn.addEventListener('mouseenter', () => {
          uploadFileBtn.style.background = '#f5f5f5';
        });
        uploadFileBtn.addEventListener('mouseleave', () => {
          uploadFileBtn.style.background = 'white';
        });
      }

      // Menu item: Upload Media
      const uploadMediaBtn = this.menu.querySelector('.upload-media');
      if (uploadMediaBtn) {
        uploadMediaBtn.addEventListener('click', () => {
          if (this.mediaInput) {
            this.mediaInput.click();
          }
          this.menu.style.display = 'none';
        });
        uploadMediaBtn.addEventListener('mouseenter', () => {
          uploadMediaBtn.style.background = '#f5f5f5';
        });
        uploadMediaBtn.addEventListener('mouseleave', () => {
          uploadMediaBtn.style.background = 'white';
        });
      }
    }

    // File input change (all files)
    if (this.fileInput) {
      this.fileInput.addEventListener('change', async (event) => {
        if (!event.target.files || event.target.files.length === 0) return;

        await Promise.all(
          Array.from(event.target.files).map(async (file) => {
            if (this.onFileUpload) {
              await this.onFileUpload(file);
            }
          }),
        );

        this.fileInput.value = '';
      });
    }

    // Media input change (images/videos)
    if (this.mediaInput) {
      this.mediaInput.addEventListener('change', async (event) => {
        if (!event.target.files || event.target.files.length === 0) return;

        await Promise.all(
          Array.from(event.target.files).map(async (file) => {
            if (this.onFileUpload) {
              await this.onFileUpload(file);
            }
          }),
        );

        this.mediaInput.value = '';
      });
    }
  }

  autoResize() {
    if (!this.textarea) return;

    const maxHeight = parseInt(this.getAttribute('max-height')) || 150;

    this.textarea.style.height = 'auto';
    let newHeight = Math.min(this.textarea.scrollHeight, maxHeight);
    this.textarea.style.height = newHeight + 'px';

    // Icon doesn't need height adjustment - it stays fixed

    // Notify parent about resize
    if (this.onResize) {
      this.onResize(newHeight);
    }

    // Dispatch custom event
    this.dispatchEvent(
      new CustomEvent('resize', { detail: { height: newHeight } }),
    );
  }

  submit() {
    if (!this.textarea) return;

    const message = this.textarea.value.trim();
    if (message.length > 0) {
      if (this.onSubmit) {
        this.onSubmit(message);
      }

      // Dispatch custom event
      this.dispatchEvent(new CustomEvent('submit', { detail: { message } }));

      // Clear input and reset height
      this.clear();
    }
  }

  clear() {
    if (this.textarea) {
      this.textarea.value = '';
      this.autoResize();
    }
  }

  getValue() {
    return this.textarea ? this.textarea.value : '';
  }

  setValue(value) {
    if (this.textarea) {
      this.textarea.value = value;
      this.autoResize();
    }
  }

  focus() {
    if (this.textarea) {
      this.textarea.focus();
    }
  }

  // Handle paste events for files
  onPaste(handler) {
    if (this.textarea) {
      this.textarea.addEventListener('paste', handler);
    }
  }
}

if (!customElements.get('chat-input-component')) {
  customElements.define('chat-input-component', ChatInputComponent);
}
