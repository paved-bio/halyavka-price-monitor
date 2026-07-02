# Белый список магазинов (whitelist)

Price Monitor работает **только** с фиксированным списком площадок. Это ограничение действует на **трёх уровнях**:

1. **Расширение** — распознаёт ссылку только если она совпадает с regex в `popup.js` / `constants.js`
2. **Сервер** — отклоняет `POST /tasks/add`, если `shop_id` не в `SAFE_SHOPS` (код 400)
3. **Воркер** — открывает вкладку **только** с URL из задачи сервера; домены заданы в `manifest.json` → `host_permissions`

**Добавить мониторинг «левого» сайта невозможно** — ни пользователю, ни злоумышленнику через сервер.

---

## Поддерживаемые магазины (12)

| ID | Название | Пример ссылки | Что можно мониторить |
|----|----------|---------------|---------------------|
| `ozon` | Ozon | `ozon.ru/product/…-1234567890` | Цена товара, наличие |
| `wb` | Wildberries | `wildberries.ru/catalog/…/detail.aspx` | Цена, наличие |
| `steam` | Steam | `steampowered.com/app/…` | Цена игры |
| `avito` | Avito | `avito.ru/…_1234567890` | Цена объявления |
| `tutu` | Tutu.ru | `tutu.ru/poezda/Moskva/Anapa/` | Цена билетов на поезд (маршрут) |
| `yandex_market` | Яндекс Маркет | `market.yandex.ru/card/…` | Цена товара |
| `dns` | DNS | `dns-shop.ru/product/…` | Цена техники |
| `goldapple` | Золотое Яблоко | `goldapple.ru/…` | Цена косметики |
| `citilink` | Ситилинк | `citilink.ru/product/…` | Цена товара |
| `mvideo` | М.Видео | `mvideo.ru/products/…` | Цена товара |
| `detmir` | Детский мир | `detmir.ru/product/index/id/…` | Цена товара |
| `leroymerlin` | Лемана ПРО | `lemanapro.ru/product/…` | Цена товара |

Селекторы цены для каждого магазина зашиты в `shop_parse_page.js` (синхронизировано с сервером).

---

## Безопасность воркера

Если вы включаете **режим воркера** (бесплатно):

- Сервер выдаёт только задачи из whitelist — URL карточки товара или маршрута Tutu
- Расширение **не может** открыть другой домен: проверка в `shop_url_guard.js` и `host_permissions`
- На вкладке видна полоса «Халявка · проверка цены»
- Снимается только **публичная** цена/наличие — как у обычного посетителя
- Пароли, cookies, файлы — **не читаются**

Очередь сети (без имён людей): `worker_info.html` → API `/meta/worker_queue`

---

## Подписка vs воркер

| | **Воркер (бесплатно)** | **Подписка ~100 ₽/мес** |
|--|------------------------|-------------------------|
| Мониторинг ваших товаров | ✅ до **100** позиций | ✅ до **100** позиций |
| Нагрузка на ваш ПК | Фоновые вкладки в idle | **Нет** — проверяют другие воркеры |
| Первые 30 дней | Триал (добавление + воркер) | — |

Без воркера и без подписки после триала новые задачи не добавляются — нужен один из вариантов.

---

## Что не в whitelist (пока)

Магазины с жёсткой антибот-защитой не добавлены: Lamoda, Vseinstrumenti, AliExpress и др.  
Список блокировок для разработчиков: `price-monitor/e2e/SHOPS_BLOCKED.md` (в основном репозитории).

---

## Аудит

- Список магазинов в коде: [`constants.js`](constants.js) → `PM_EXTENSION.supportedShops`
- Разрешения Chrome: [`manifest.json`](manifest.json) → `host_permissions`
- Парсинг только whitelist: [`shop_url_guard.js`](shop_url_guard.js), [`background.js`](background.js) → `parseViaBackgroundTab`
- Биржа (отдельно): [`category_hosts.js`](category_hosts.js) — свои домены по категориям

Открытый репозиторий: [github.com/paved-bio/halyavka-price-monitor](https://github.com/paved-bio/halyavka-price-monitor)
