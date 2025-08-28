class PolicyContentExtractor {
  constructor() {
    this.policyKeywords = [
      'privacy policy', 'data protection', 'personal information',
      'data collection', 'terms of service', 'terms of use',
      'cookie policy', 'user agreement', 'privacy notice',
      'data processing', 'gdpr', 'ccpa', 'personal data'
    ];
    
    this.policySelectors = [
      '[class*="privacy"]', '[id*="privacy"]',
      '[class*="terms"]', '[id*="terms"]',
      '[class*="legal"]', '[id*="legal"]',
      '[class*="policy"]', '[id*="policy"]',
      'main', 'article', '.content', '#content'
    ];
    
    this.urlPatterns = [
      /privacy[-_]?policy/i,
      /terms[-_]?of[-_]?(service|use)/i,
      /cookie[-_]?policy/i,
      /data[-_]?protection/i,
      /legal/i
    ];
    
    this.init();
  }

  init() {
    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true; // Keep message channel open for async response
    });
  }

  async handleMessage(request, sender, sendResponse) {
    try {
      switch (request.action) {
        case 'checkPolicy':
          const detected = this.detectPolicy();
          sendResponse({ policyDetected: detected });
          break;
          
        case 'extractPolicy':
          const content = await this.extractPolicyContent();
          sendResponse({ content: content });
          break;
          
        default:
          sendResponse({ error: 'Unknown action' });
      }
    } catch (error) {
      console.error('Content script error:', error);
      sendResponse({ error: error.message });
    }
  }

  detectPolicy() {
    // Method 1: Check URL patterns
    if (this.checkUrlForPolicy()) {
      return true;
    }
    
    // Method 2: Check page title and headings
    if (this.checkTitleAndHeadings()) {
      return true;
    }
    
    // Method 3: Check for policy content selectors
    if (this.checkPolicySelectors()) {
      return true;
    }
    
    // Method 4: Check for policy keywords in content
    if (this.checkContentKeywords()) {
      return true;
    }
    
    return false;
  }

  checkUrlForPolicy() {
    const url = window.location.href.toLowerCase();
    const pathname = window.location.pathname.toLowerCase();
    
    return this.urlPatterns.some(pattern => 
      pattern.test(url) || pattern.test(pathname)
    );
  }

  checkTitleAndHeadings() {
    const title = document.title.toLowerCase();
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
      .map(h => h.textContent.toLowerCase());
    
    const allText = [title, ...headings].join(' ');
    
    return this.policyKeywords.some(keyword => 
      allText.includes(keyword)
    );
  }

  checkPolicySelectors() {
    for (const selector of this.policySelectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        if (this.isPolicyContent(element)) {
          return true;
        }
      }
    }
    return false;
  }

  checkContentKeywords() {
    const mainContent = this.getMainContent();
    const text = mainContent.textContent.toLowerCase();
    
    let keywordCount = 0;
    this.policyKeywords.forEach(keyword => {
      if (text.includes(keyword)) {
        keywordCount++;
      }
    });
    
    // If we find multiple policy keywords, likely a policy page
    return keywordCount >= 3;
  }

  isPolicyContent(element) {
    const text = element.textContent.toLowerCase();
    const keywordCount = this.policyKeywords.filter(keyword => 
      text.includes(keyword)
    ).length;
    
    // Consider it policy content if it has multiple keywords and substantial length
    return keywordCount >= 2 && text.length > 500;
  }

  getMainContent() {
    // Try to find main content area using various strategies
    const candidates = [
      document.querySelector('main'),
      document.querySelector('[role="main"]'),
      document.querySelector('.main-content'),
      document.querySelector('#main-content'),
      document.querySelector('.content'),
      document.querySelector('#content'),
      document.querySelector('article'),
      document.body
    ];
    
    for (const candidate of candidates) {
      if (candidate && candidate.textContent.length > 100) {
        return candidate;
      }
    }
    
    return document.body;
  }

  async extractPolicyContent() {
    let policyElement = this.findBestPolicyElement();
    
    if (!policyElement) {
      policyElement = this.getMainContent();
    }
    
    if (!policyElement) {
      throw new Error('No content found to extract');
    }
    
    const extractedText = this.cleanExtractedText(policyElement.textContent);
    
    if (extractedText.length < 500) {
      throw new Error('Insufficient policy content found (less than 500 characters)');
    }
    
    return extractedText;
  }

  findBestPolicyElement() {
    let bestElement = null;
    let bestScore = 0;
    
    for (const selector of this.policySelectors) {
      const elements = document.querySelectorAll(selector);
      
      for (const element of elements) {
        const score = this.scorePolicyElement(element);
        if (score > bestScore) {
          bestScore = score;
          bestElement = element;
        }
      }
    }
    
    return bestElement;
  }

  scorePolicyElement(element) {
    const text = element.textContent.toLowerCase();
    let score = 0;
    
    // Score based on policy keywords
    this.policyKeywords.forEach(keyword => {
      if (text.includes(keyword)) {
        score += 10;
      }
    });
    
    // Score based on text length (prefer substantial content)
    if (text.length > 1000) score += 20;
    else if (text.length > 500) score += 10;
    
    // Score based on element structure
    if (element.tagName === 'MAIN') score += 15;
    else if (element.tagName === 'ARTICLE') score += 12;
    else if (element.id.includes('policy') || element.id.includes('terms')) score += 10;
    else if (element.className.includes('policy') || element.className.includes('terms')) score += 8;
    
    return score;
  }

  cleanExtractedText(text) {
    return text
      .replace(/\s+/g, ' ')           // Normalize whitespace
      .replace(/\n\s*\n/g, '\n')      // Remove empty lines
      .trim()                         // Remove leading/trailing whitespace
      .substring(0, 10000);           // Limit to 10k characters for API efficiency
  }
}

// Initialize the content extractor
const policyExtractor = new PolicyContentExtractor();