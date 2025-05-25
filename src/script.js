/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import '/src/index.css';

import {
  initializeSQLite,
  getUUIDs,
  loadSession,
  saveSession,
  deleteSession,
} from './sqlite';
import { fileOpen } from 'browser-fs-access';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(location.href + '/service-worker.js')
      .then((registration) => {
        console.log(
          'Service Worker registered with scope:',
          registration.scope,
        );
      })
      .catch((error) => {
        console.error('Service Worker registration failed:', error);
      });
  });
}

const assistantTemplate = document.querySelector('#assistant');
const conversationTemplate = document.querySelector('#conversation');
const newAssistantButton = document.querySelector('.new-assistant');
const stopButton = document.querySelector('.stop-button');
const fileOpenButton = document.querySelector('.file-open-button');
const imagePreview = document.querySelector('.image-preview');
const removeImageButton = document.querySelector('.remove-image-button');
const assistantContainer = document.querySelector('.assistant-container');
const promptForm = document.querySelector('.prompt-form');
const activeAssistantForm = document.querySelector('.active-assistant-form');
const promptInput = document.querySelector('.prompt-input');
const assistants = {};

let controller = null;
let file = null;

stopButton.addEventListener('click', () => {
  controller?.abort();
});

const sizeImage = (img) => {
  const aspectRatio = img.naturalWidth / img.naturalHeight;
  img.width = img.naturalWidth;
  img.height = img.naturalHeight;
  if (aspectRatio > 1) {
    img.style.width = '100px';
    img.style.height = 'auto';
  } else {
    img.style.width = 'auto';
    img.style.height = '100px';
  }
};

removeImageButton.addEventListener('click', () => {
  imagePreview.hidden = true;
  imagePreview.src = '';
  removeImageButton.hidden = true;
  file = null;
});

fileOpenButton.addEventListener('click', async () => {
  file = await fileOpen({
    multiple: false,
    mimeTypes: ['image/*'],
    description: 'Image files',
    startIn: 'pictures',
    excludeAcceptAllOption: true,
  });
  if (!file) {
    return;
  }
  removeImageButton.hidden = false;
  imagePreview.addEventListener('load', () => {
    URL.revokeObjectURL(imagePreview.src);
    sizeImage(imagePreview);
    imagePreview.hidden = false;
  });
  imagePreview.src = URL.createObjectURL(file);
});

(async function init() {
  await initializeSQLite();

  const { defaultTopK: topK, defaultTemperature: temperature } =
    await LanguageModel.params();

  const uuids = await getUUIDs();
  if (uuids.length) promptForm.hidden = false;

  let isFirst = true;
  for (const uuid of uuids) {
    const session = await loadSession(uuid);
    const options = {
      initialPrompts: session.initialPrompts,
      topK,
      temperature,
      conversationSummary: session.conversationSummary,
      expectedInputs: [{ type: 'text' }, { type: 'image' }],
    };
    const assistant = await self.LanguageModel.create(options);
    const { inputQuota, inputUsage } = assistant;
    assistants[uuid] = { assistant, options };

    const assistantClone = assistantTemplate.content.cloneNode(true);
    if (isFirst) {
      assistantClone.querySelector('details').open = true;
      assistantClone.querySelector('input').checked = true;
      isFirst = false;
    }
    assistantClone.querySelector('.conversation-summary').textContent =
      options.conversationSummary;
    assistantClone.querySelector('input').value = uuid;
    const conversationContainer = assistantClone.querySelector(
      '.conversation-container',
    );
    assistantClone.querySelector('.tokens-so-far').textContent = inputUsage;
    assistantClone.querySelector('.tokens-left').textContent =
      inputQuota - assistant.inputUsage;
    assistantContainer.append(assistantClone);

    for (const initialPrompt of options.initialPrompts) {
      if (initialPrompt.role === 'system') continue;
      const conversationClone = conversationTemplate.content.cloneNode(true);
      const item = conversationClone.querySelector('.item');
      item.classList.add(initialPrompt.role);
      for (const content of initialPrompt.content) {
        if (content.type === 'image') {
          const img = document.createElement('img');
          img.addEventListener('load', () => {
            URL.revokeObjectURL(img.src);
            sizeImage(img);
          });
          img.src = URL.createObjectURL(content.value);
          item.append(img);
        } else if (content.type === 'text') {
          item.append(content.value);
        }
        conversationContainer.append(conversationClone);
      }
    }
  }
})();

activeAssistantForm.addEventListener('click', async (e) => {
  const nodeName = e.target.nodeName.toLowerCase();
  if (nodeName !== 'summary' && nodeName !== 'button') return;

  if (nodeName === 'summary') {
    setTimeout(() => {
      const openDetails = activeAssistantForm.querySelector(
        'details[open] input',
      );
      if (openDetails) openDetails.checked = true;
    }, 0);
  } else if (e.target.classList.contains('delete-conversation')) {
    const details = e.target.closest('details');
    const uuid = details.querySelector('[name="active-assistant"]').value;
    details.remove();
    await deleteSession(uuid);
  }
});

const createAssistant = async (options = {}) => {
  const uuid = crypto.randomUUID();
  options.initialPrompts ||= [
    {
      role: 'system',
      content: [{ type: 'text', value: 'You are a helpful assistant.' }],
    },
  ];
  options.conversationSummary ||= 'New conversation';
  options.expectedInputs ||= [{ type: 'text' }, { type: 'image' }];
  const assistant = await self.LanguageModel.create(options);
  assistants[uuid] = { assistant, options };
  await saveSession(uuid, options);
  return uuid;
};

newAssistantButton.addEventListener('click', async () => {
  const uuid = await createAssistant();
  const assistantClone = assistantTemplate.content.cloneNode(true);
  assistantClone.querySelector('.conversation-summary').textContent =
    'New conversation';
  assistantClone.querySelector('input').value = uuid;
  assistantContainer.append(assistantClone);
  assistantContainer
    .querySelectorAll('details')
    .forEach((d) => (d.open = false));
  assistantContainer.querySelector(`details:has([value="${uuid}"])`).open =
    true;
  assistantContainer.querySelector(`[value="${uuid}"]`).checked = true;
  promptForm.hidden = false;
  promptInput.value = '';
  promptInput.focus();
});

promptForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const textPrompt = promptInput.value.trim();
  if (!textPrompt) return;
  if (!activeAssistantForm.querySelector('details[open]')) {
    alert('Select an active assistant first.');
    return;
  }
  const formData = new FormData(activeAssistantForm);
  const uuid = formData.get('active-assistant');
  const { assistant, options } = assistants[uuid];
  const conversationContainer = activeAssistantForm.querySelector(
    `input[value="${uuid}"] + .conversation-container`,
  );

  let result = '';
  let userClone;
  if (file) {
    userClone = conversationTemplate.content.cloneNode(true);
    userClone.querySelector('.item').classList.add('user');
    userClone.querySelector('.item').textContent = textPrompt;
    conversationContainer.append(userClone);

    userClone = conversationTemplate.content.cloneNode(true);
    userClone.querySelector('.item').classList.add('user');
    const img = document.createElement('img');
    img.addEventListener('load', () => {
      URL.revokeObjectURL(img.src);
      sizeImage(img);
    });
    img.src = URL.createObjectURL(file);
    userClone.querySelector('.item').append(img);
    conversationContainer.append(userClone);
  } else {
    userClone = conversationTemplate.content.cloneNode(true);
    userClone.querySelector('.item').classList.add('user');
    userClone.querySelector('.item').textContent = textPrompt;
    conversationContainer.append(userClone);
  }

  try {
    controller = new AbortController();
    let stream;
    if (!file) {
      stream = assistant.promptStreaming(textPrompt, {
        signal: controller.signal,
      });
    } else {
      stream = assistant.promptStreaming(
        [
          {
            role: 'user',
            content: [
              { type: 'text', value: textPrompt },
              { type: 'image', value: file },
            ],
          },
        ],
        { signal: controller.signal },
      );
    }

    const assistantClone = conversationTemplate.content.cloneNode(true);
    const item = assistantClone.querySelector('.item');
    item.classList.add('assistant');
    conversationContainer.append(assistantClone);

    for await (const chunk of stream) {
      item.append(chunk);
      result += chunk;
    }

    const details = conversationContainer.closest('details');
    details.querySelector('.tokens-so-far').textContent = assistant.inputUsage;
    details.querySelector('.tokens-left').textContent =
      assistant.inputQuota - assistant.inputUsage;

    if (!file) {
      options.initialPrompts.push(
        { role: 'user', content: [{ type: 'text', value: textPrompt }] },
        { role: 'assistant', content: [{ type: 'text', value: result }] },
      );
    } else {
      options.initialPrompts.push(
        { role: 'user', content: [{ type: 'text', value: textPrompt }] },
        { role: 'user', content: [{ type: 'image', value: file }] },
        { role: 'assistant', content: [{ type: 'text', value: result }] },
      );
    }

    promptInput.value = '';
    file = null;
    imagePreview.hidden = true;
    imagePreview.src = '';
    removeImageButton.hidden = true;
    promptInput.focus();

    const summaryAssistant = await self.LanguageModel.create(options);
    const summaryStream = summaryAssistant.promptStreaming(
      'Summarize the conversation as briefly as possible in one short sentence.',
    );
    const conversationSummary = details.querySelector('summary');
    let firstTime = true;
    for await (const chunk of summaryStream) {
      if (firstTime) conversationSummary.textContent = '';
      conversationSummary.append(chunk);
      firstTime = false;
    }
    summaryAssistant.destroy();

    options.conversationSummary = conversationSummary.textContent;
    await saveSession(uuid, options);
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error(err.name, err.message);
    }
  }
});
