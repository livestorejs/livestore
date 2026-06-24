const DEFAULT_ACTIONS = {
  copy: {
    label: 'Copy page',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy-icon lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
    className: 'copy-action',
    action: async () => {
      const markdownUrl = new URL('index.md', window.location.href.replace(/\/?$/, '/')).toString()
      try {
        /**
         * The MIT License (MIT) Copyright (c) 2021 Cloudflare, Inc.
         * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
         * The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
         */
        const clipboardItem = new ClipboardItem({
          ['text/plain']: fetch(markdownUrl)
            .then((r) => r.text())
            .then((t) => new Blob([t], { type: 'text/plain' }))
            .catch((e) => {
              throw new Error(`Received ${e.message} for ${markdownUrl}`)
            }),
        })

        await navigator.clipboard.write([clipboardItem])

        const buttonElement = document.querySelector('.copy-action')
        const originalContent = buttonElement.innerHTML
        const textSpan = buttonElement.querySelector('span')
        if (textSpan) {
          textSpan.textContent = 'Copied!'
        } else {
          buttonElement.textContent = 'Copied!'
        }

        setTimeout(() => {
          buttonElement.innerHTML = originalContent
        }, 2000)
      } catch (error) {
        console.error('Failed to copy Markdown:', error)
      }
    },
  },
  view: {
    label: 'View as Markdown',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="208" height="128" viewBox="0 0 208 128"><rect width="198" height="118" x="5" y="5" ry="10" stroke="currentColor" stroke-width="10" fill="transparent"/><path stroke="currentColor" fill="currentColor" d="M30 98V30h20l20 25 20-25h20v68H90V59L70 84 50 59v39zm125 0l-30-33h20V30h20v35h20z"/></svg>`,
    action: () => {
      window.open(new URL('index.md', window.location.href.replace(/\/?$/, '/')), '_blank')
    },
  },
  chatgpt: {
    label: 'Open in ChatGPT',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" stroke="transparent" fill="currentColor"><path d="m297.06 130.97c7.26-21.79 4.76-45.66-6.85-65.48-17.46-30.4-52.56-46.04-86.84-38.68-15.25-17.18-37.16-26.95-60.13-26.81-35.04-.08-66.13 22.48-76.91 55.82-22.51 4.61-41.94 18.7-53.31 38.67-17.59 30.32-13.58 68.54 9.92 94.54-7.26 21.79-4.76 45.66 6.85 65.48 17.46 30.4 52.56 46.04 86.84 38.68 15.24 17.18 37.16 26.95 60.13 26.8 35.06.09 66.16-22.49 76.94-55.86 22.51-4.61 41.94-18.7 53.31-38.67 17.57-30.32 13.55-68.51-9.94-94.51zm-120.28 168.11c-14.03.02-27.62-4.89-38.39-13.88.49-.26 1.34-.73 1.89-1.07l63.72-36.8c3.26-1.85 5.26-5.32 5.24-9.07v-89.83l26.93 15.55c.29.14.48.42.52.74v74.39c-.04 33.08-26.83 59.9-59.91 59.97zm-128.84-55.03c-7.03-12.14-9.56-26.37-7.15-40.18.47.28 1.3.79 1.89 1.13l63.72 36.8c3.23 1.89 7.23 1.89 10.47 0l77.79-44.92v31.1c.02.32-.13.63-.38.83l-64.41 37.19c-28.69 16.52-65.33 6.7-81.92-21.95zm-16.77-139.09c7-12.16 18.05-21.46 31.21-26.29 0 .55-.03 1.52-.03 2.2v73.61c-.02 3.74 1.98 7.21 5.23 9.06l77.79 44.91-26.93 15.55c-.27.18-.61.21-.91.08l-64.42-37.22c-28.63-16.58-38.45-53.21-21.95-81.89zm221.26 51.49-77.79-44.92 26.93-15.54c.27-.18.61-.21.91-.08l64.42 37.19c28.68 16.57 38.51 53.26 21.94 81.94-7.01 12.14-18.05 21.44-31.2 26.28v-75.81c.03-3.74-1.96-7.2-5.2-9.06zm26.8-40.34c-.47-.29-1.3-.79-1.89-1.13l-63.72-36.8c-3.23-1.89-7.23-1.89-10.47 0l-77.79 44.92v-31.1c-.02-.32.13-.63.38-.83l64.41-37.16c28.69-16.55 65.37-6.7 81.91 22 6.99 12.12 9.52 26.31 7.15 40.1zm-168.51 55.43-26.94-15.55c-.29-.14-.48-.42-.52-.74v-74.39c.02-33.12 26.89-59.96 60.01-59.94 14.01 0 27.57 4.92 38.34 13.88-.49.26-1.33.73-1.89 1.07l-63.72 36.8c-3.26 1.85-5.26 5.31-5.24 9.06l-.04 89.79zm14.63-31.54 34.65-20.01 34.65 20v40.01l-34.65 20-34.65-20z"/></svg>`,
    action: () => {
      const message = `Read from ${window.location.href} so I can ask questions about it.`
      window.open(`https://chat.openai.com/?q=${message}`, '_blank')
    },
  },
  claude: {
    label: 'Open in Claude',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 92.2 65" stroke="transparent" fill="currentColor"><path class="st0" d="M66.5,0H52.4l25.7,65h14.1L66.5,0z M25.7,0L0,65h14.4l5.3-13.6h26.9L51.8,65h14.4L40.5,0C40.5,0,25.7,0,25.7,0zM24.3,39.3l8.8-22.8l8.8,22.8H24.3z"></path></svg>`,
    action: () => {
      const message = `Read from ${window.location.href} so I can ask questions about it.`
      window.open(`https://claude.ai/new?q=${message}`, '_blank')
    },
  },
}

function createMenuItemsFromActions(actions) {
  return actions
    .map((action) => {
      // Handle both string actions and object actions
      if (typeof action === 'string') {
        const menuItem = DEFAULT_ACTIONS[action]
        if (!menuItem) {
          console.warn(`Unknown action: ${action}. Available actions: ${Object.keys(DEFAULT_ACTIONS).join(', ')}`)
          return null
        }
        return { ...menuItem }
      } else if (typeof action === 'object' && action !== null) {
        // Custom action object
        return { ...action }
      }

      return null
    })
    .filter(Boolean)
}

function initContextualMenu(config) {
  // Generate menu items from actions or use provided menuItems
  const menuItems = createMenuItemsFromActions(config.actions)

  document.addEventListener('DOMContentLoaded', () => {
    const titleElement = document.querySelector('.sl-container>h1')

    if (!titleElement) {
      console.warn('Contextual menu: Could not find page title element')
      return
    }

    const parentElement = titleElement.parentElement
    if (!parentElement) {
      console.warn('Contextual menu: Could not find parent element of title')
      return
    }

    const menuContainer = document.createElement('div')
    menuContainer.id = 'contextual-menu-container'
    menuContainer.className = `contextual-menu-container`

    let mainActionButton = null
    if (menuItems.length > 0) {
      const firstItem = menuItems[0]
      mainActionButton = document.createElement('button')
      mainActionButton.className = `contextual-main-action ${firstItem.className || ''}`.trim()
      mainActionButton.textContent = firstItem.label

      mainActionButton.addEventListener('click', (e) => {
        e.preventDefault()
        if (firstItem.action && typeof firstItem.action === 'function') {
          firstItem.action()
        }
      })

      if (firstItem.icon) {
        mainActionButton.innerHTML = `${firstItem.icon}<span>${firstItem.label}</span>`
      }
    }

    const triggerButton = document.createElement('button')
    triggerButton.id = 'contextual-menu-trigger'
    triggerButton.className = 'contextual-menu-trigger'
    triggerButton.ariaLabel = 'Open contextual menu'
    triggerButton.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" 
           width="20" 
           height="20" 
           viewBox="0 0 24 24"
           fill="none" 
           stroke="currentColor" 
           stroke-width="2" 
           stroke-linecap="round" 
           stroke-linejoin="round">
        <path d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zM12 13a1 1 0 110-2 1 1 0 010 2zM12 20a1 1 0 110-2 1 1 0 010 2z"/>
      </svg>
    `

    const dropdownMenu = document.createElement('div')
    dropdownMenu.id = 'contextual-dropdown-menu'
    dropdownMenu.className = 'contextual-dropdown-menu'

    menuItems.forEach((item) => {
      const menuItem = document.createElement('button')
      menuItem.className = `contextual-menu-item ${item.className || ''}`.trim()
      menuItem.textContent = item.label

      menuItem.addEventListener('click', (e) => {
        e.preventDefault()
        if (item.action && typeof item.action === 'function') {
          item.action()
        }
        closeMenu() // Close the menu after action is executed
      })

      if (item.icon) {
        menuItem.innerHTML = `${item.icon}<span>${item.label}</span>`
      }

      dropdownMenu.appendChild(menuItem)
    })

    if (mainActionButton) {
      menuContainer.appendChild(mainActionButton)
    }
    menuContainer.appendChild(triggerButton)
    menuContainer.appendChild(dropdownMenu)

    parentElement.style.display = 'flex'
    parentElement.style.justifyContent = 'space-between'
    parentElement.style.alignItems = 'flex-start'
    parentElement.classList.add('contextual-menu-parent')
    parentElement.appendChild(menuContainer)

    const style = document.createElement('style')
    style.textContent = `
      .contextual-menu-container {
        position: relative;
        display: inline-flex;
        align-items: center;
        margin-left: auto;
      }
      
      .contextual-main-action {
        background: var(--sl-color-bg);
        color: var(--sl-color-text);
        border: 1px solid var(--sl-color-gray-5);
        border-right: none;
        border-radius: 0.5rem 0 0 0.5rem;
        padding: 8px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        text-decoration: none;
        height: 2rem;
        font-size: 14px;
        line-height: 1.5;
        font-family: inherit;
      }
      
      .contextual-main-action:hover {
        background: var(--sl-color-hairline-light);
      }
      
      .contextual-main-action svg {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
      }
      
      .contextual-menu-trigger {
        background: var(--sl-color-bg);
        border: 1px solid var(--sl-color-gray-5);
        border-radius: 0 0.5rem 0.5rem 0;
        padding: 8px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        height: 2rem;
        color: var(--sl-color-text);
      }
      
      .contextual-menu-trigger:hover {
        background: var(--sl-color-hairline-light);
      }
      
      .contextual-dropdown-menu {
        position: absolute;
        top: calc(100% + 10px);
        right: 0;
        background: var(--sl-color-bg);
        border: 1px solid var(--sl-color-gray-5);
        border-radius: 0.5rem;
        box-shadow: var(--sl-shadow-md);
        min-width: 180px;
        opacity: 0;
        visibility: hidden;
        transform: translateY(-10px);
        transition: opacity 0.15s ease, visibility 0.15s ease, transform 0.15s ease;
        z-index: 1000;
        padding: 4px;
      }
      
      .contextual-dropdown-menu.show {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
      }
      
      .contextual-menu-item {
        display: flex;
        align-items: center;
        padding: 8px 12px;
        color: var(--sl-color-text);
        text-decoration: none;
        font-size: 14px;
        line-height: 1.5;
        gap: 8px;
        border-radius: 0.5rem;
        border: none;
        background: transparent;
        width: 100%;
        text-align: left;
        cursor: pointer;
        font-family: inherit;
      }
      
      .contextual-menu-item:hover {
        background: var(--sl-color-hairline-light);
      }
      
      .contextual-menu-item svg {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
      }
      
        /* Mobile responsive */
        @media (max-width: 72rem) {
          .contextual-menu-parent {
            flex-direction: column;
          }

          .contextual-menu-container {
            margin-left: 0;
          }
          
          .contextual-dropdown-menu {
            left: 0;
            right: auto;
          }
        }
    `
    document.head.appendChild(style)

    let isMenuOpen = false

    const toggleMenu = () => {
      isMenuOpen = !isMenuOpen
      dropdownMenu.classList.toggle('show', isMenuOpen)
      triggerButton.ariaExpanded = isMenuOpen.toString()
    }

    const closeMenu = () => {
      isMenuOpen = false
      dropdownMenu.classList.remove('show')
      triggerButton.ariaExpanded = 'false'
    }

    triggerButton.addEventListener('click', (e) => {
      e.stopPropagation()
      toggleMenu()
    })

    document.addEventListener('click', (e) => {
      if (!menuContainer.contains(e.target)) {
        closeMenu()
      }
    })

    return () => {
      if (menuContainer.parentNode) {
        menuContainer.parentNode.removeChild(menuContainer)
      }
      if (style.parentNode) {
        style.parentNode.removeChild(style)
      }
    }
  })
}

export default initContextualMenu
