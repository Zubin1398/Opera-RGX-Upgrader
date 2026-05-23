# Opera-RGX upgrader

## Project Overview

Пользовательский скрипт Tampermonkey/Greasemonkey для улучшения работы Opera RGX на страницах VK Video.

Скрипт помогает Opera заметить динамически созданные `<video>`-элементы, включая видео внутри Shadow DOM. Для этого он отслеживает появление видеоплееров, мягко стимулирует media-события и создаёт light DOM mirror через `captureStream()`.

**Ключевые особенности:**

- Обнаруживает динамически созданные `<video>`-элементы
- Отслеживает видео внутри Shadow DOM
- Патчит создание video-элементов через `document.createElement`
- Отслеживает изменения `src` у video-элементов
- Создаёт light DOM mirror для видео, которое Opera RGX может обработать
- Временно скрывает mirror при взаимодействии с плеером, чтобы не перекрывать контролы
- Поддерживает домены `vk.com`, `*.vk.com`, `vkvideo.ru`, `*.vkvideo.ru`, `m.vkvideo.ru`

## Установка

1. Установите расширение **Tampermonkey** или совместимый userscript-менеджер:
   - Chrome: [Chrome Web Store](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
   - Firefox: [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/tampermonkey/)
   - Edge: [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)
   - Opera: [Opera addons](https://addons.opera.com/extensions/details/tampermonkey-beta/)

2. Откройте `opera-rgx-upgrader.user.js` в браузере. Tampermonkey предложит установить скрипт.

3. Убедитесь, что userscript включён в менеджере скриптов.

## Использование

1. Откройте страницу VK Video или ролик на `m.vkvideo.ru` or `vkvideo.ru`.
2. Запустите видео.
3. Скрипт автоматически обнаружит видеоплеер и создаст mirror-элемент для RGX.
4. При движении мыши, клике, прокрутке или нажатии клавиш mirror временно скрывается, чтобы были доступны контролы плеера.

Скрипт не добавляет кнопок и не меняет интерфейс страницы.

## Технические подробности

### Как это работает

1. **Ранний запуск:** скрипт стартует на `document-start`, чтобы успеть пропатчить создание video-элементов до инициализации плеера.

2. **Мониторинг DOM и Shadow DOM:** используется `MutationObserver`, а также патч `Element.prototype.attachShadow`, чтобы находить видео внутри Shadow DOM.

3. **Отслеживание media-событий:** скрипт слушает события `loadedmetadata`, `loadeddata`, `canplay`, `playing` и другие события жизненного цикла видео.

4. **Mirror через `captureStream()`:** для найденного видео создаётся дополнительный muted/autoplay `<video>` в light DOM. Opera RGX лучше распознаёт такой элемент.

5. **Компромисс с контролами:** mirror находится поверх плеера, но временно скрывается при взаимодействии пользователя с плеером.

### Ограничения

- Скрипт ориентирован на VK Video и не предназначен для обхода DRM или защиты контента.
- Если браузер запрещает `captureStream()` для конкретного видео, mirror не будет создан.
- Скрипт не скачивает видео и не извлекает прямые ссылки на медиафайлы.

## Технологии

- **JavaScript** ES6+
- **Tampermonkey/Greasemonkey**
- DOM API
- Shadow DOM API
- HTMLMediaElement API
- Media Capture from DOM Elements API

## История версий

| Версия | Примечания |
|--------|------------|
| 0.1.0 | Начальная версия для VK/VK Video: обнаружение video, Shadow DOM observer, mirror через `captureStream()` |
