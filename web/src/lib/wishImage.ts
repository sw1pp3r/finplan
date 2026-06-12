// Подбор bundled-фолбэка для мечты без своей картинки — по ключевым словам
// категории/названия. Файлы лежат в web/public/wishes/ (раздаются как /wishes/*).
// Нет совпадения → null → карточка рисует типографический градиент (это by design,
// не «битая» картинка).

const FALLBACKS: { img: string; keys: string[] }[] = [
  {
    img: "/wishes/fallback-travel.webp",
    keys: ["travel", "trip", "путешеств", "отпуск", "поездк", "japan", "япони", "тур", "море", "ocean", "vacation", "отдых"],
  },
  {
    img: "/wishes/fallback-tech.webp",
    keys: ["tech", "техник", "гаджет", "laptop", "macbook", "iphone", "phone", "комп", "ноут", "watch", "часы", "камер", "camera", "device"],
  },
  {
    img: "/wishes/fallback-home.webp",
    keys: ["home", "дом", "жиль", "квартир", "интерьер", "мебель", "ремонт", "house", "apartment", "кухн"],
  },
]

export function fallbackImage(category: string | null, name: string): string | null {
  const hay = `${category ?? ""} ${name}`.toLowerCase()
  for (const f of FALLBACKS) {
    if (f.keys.some((k) => hay.includes(k))) return f.img
  }
  return null
}
