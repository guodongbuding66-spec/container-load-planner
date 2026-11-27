export type UiLanguage = "zh" | "en" | "es" | "de" | "fr" | "ja" | "ko" | "pt";

export interface LanguageOption {
  code: UiLanguage;
  label: string;
  htmlLang: string;
  title: string;
}

export const SUPPORTED_LANGUAGES: readonly LanguageOption[] = [
  { code: "zh", label: "简体中文", htmlLang: "zh-CN", title: "外贸装柜智算 · CargoFit" },
  { code: "en", label: "English", htmlLang: "en", title: "CargoFit | Container Load Planner" },
  { code: "es", label: "Español", htmlLang: "es", title: "CargoFit | Planificador de Carga" },
  { code: "de", label: "Deutsch", htmlLang: "de", title: "CargoFit | Container-Ladeplaner" },
  { code: "fr", label: "Français", htmlLang: "fr", title: "CargoFit | Planificateur de Chargement" },
  { code: "ja", label: "日本語", htmlLang: "ja", title: "CargoFit | コンテナ積載プランナー" },
  { code: "ko", label: "한국어", htmlLang: "ko", title: "CargoFit | 컨테이너 적재 플래너" },
  { code: "pt", label: "Português", htmlLang: "pt", title: "CargoFit | Planejador de Carga" },
] as const;

const VALID_LANGS = new Set<string>(SUPPORTED_LANGUAGES.map((l) => l.code));

export function isUiLanguage(value: string | null | undefined): value is UiLanguage {
  return typeof value === "string" && VALID_LANGS.has(value);
}

export function getLanguageMeta(language: UiLanguage): LanguageOption {
  return SUPPORTED_LANGUAGES.find((l) => l.code === language) ?? SUPPORTED_LANGUAGES[0];
}

type NonBaseLanguage = Exclude<UiLanguage, "zh" | "en">;

/**
 * Multi-language dictionary keyed by canonical English UI strings.
 * Any string not explicitly listed here cleanly falls back to English (never leaks Chinese).
 */
const TRANSLATIONS: Record<string, Record<NonBaseLanguage, string>> = {
  // Brand & Topbar
  "CargoFit": { es: "CargoFit", de: "CargoFit", fr: "CargoFit", ja: "CargoFit", ko: "CargoFit", pt: "CargoFit" },
  "Draft saved locally": {
    es: "Borrador guardado", de: "Lokal gespeichert", fr: "Brouillon enregistré",
    ja: "ローカル保存済", ko: "로컬 저장됨", pt: "Rascunho salvo",
  },
  "Files & backups": {
    es: "Archivos", de: "Dateien", fr: "Fichiers",
    ja: "ファイル", ko: "파일/백업", pt: "Arquivos",
  },
  "Cloud account": {
    es: "Cuenta nube", de: "Cloud-Konto", fr: "Compte cloud",
    ja: "クラウド", ko: "클라우드", pt: "Conta nuvem",
  },
  "Plan tools": {
    es: "Herramientas", de: "Plan-Tools", fr: "Outils plan",
    ja: "プランツール", ko: "플랜 도구", pt: "Ferramentas",
  },
  "Other tools": {
    es: "Más", de: "Weitere", fr: "Autres",
    ja: "その他", ko: "기타 도구", pt: "Outros",
  },
  "Tutorials": {
    es: "Guías", de: "Anleitung", fr: "Tutoriels",
    ja: "ガイド", ko: "가이드", pt: "Tutoriais",
  },
  "Help": {
    es: "Ayuda", de: "Hilfe", fr: "Aide",
    ja: "ヘルプ", ko: "도움말", pt: "Ajuda",
  },
  "Help & contact": {
    es: "Ayuda y contacto", de: "Hilfe & Kontakt", fr: "Aide et contact",
    ja: "ヘルプ・連絡先", ko: "도움말 및 문의", pt: "Ajuda e contato",
  },
  "Display unit": {
    es: "Unidad de medida", de: "Maßeinheit", fr: "Unité d'affichage",
    ja: "表示単位", ko: "표시 단위", pt: "Unidade",
  },
  "Toggle dark mode": {
    es: "Cambiar modo oscuro", de: "Dunkelmodus umschalten", fr: "Basculer le mode sombre",
    ja: "ダークモード切替", ko: "다크 모드 전환", pt: "Alternar modo escuro",
  },

  // Wizard Steps (1-7)
  "Container": { es: "Contenedor", de: "Container", fr: "Conteneur", ja: "コンテナ", ko: "컨테이너", pt: "Contêiner" },
  "Packaging": { es: "Embalaje", de: "Paletten", fr: "Palettes", ja: "パレット", ko: "팔레트", pt: "Paletes" },
  "Cargo": { es: "Carga", de: "Fracht", fr: "Marchandise", ja: "貨物", ko: "화물", pt: "Carga" },
  "Layout": { es: "Disposición", de: "Layout", fr: "Disposition", ja: "配置", ko: "배치", pt: "Layout" },
  "Rules": { es: "Reglas", de: "Regeln", fr: "Règles", ja: "ルール", ko: "규칙", pt: "Regras" },
  "Review": { es: "Revisar", de: "Prüfen", fr: "Vérifier", ja: "確認", ko: "검토", pt: "Revisão" },
  "Results": { es: "Resultados", de: "Ergebnis", fr: "Résultats", ja: "結果", ko: "결과", pt: "Resultados" },
  "Inputs ready": {
    es: "Datos listos", de: "Eingaben bereit", fr: "Données prêtes",
    ja: "入力完了", ko: "입력 준비됨", pt: "Dados prontos",
  },
  "Back": { es: "Atrás", de: "Zurück", fr: "Retour", ja: "戻る", ko: "이전", pt: "Voltar" },
  "Next": { es: "Siguiente", de: "Weiter", fr: "Suivant", ja: "次へ", ko: "다음", pt: "Próximo" },
  "Close": { es: "Cerrar", de: "Schließen", fr: "Fermer", ja: "閉じる", ko: "닫기", pt: "Fechar" },
  "Cancel": { es: "Cancelar", de: "Abbrechen", fr: "Annuler", ja: "キャンセル", ko: "취소", pt: "Cancelar" },
  "Save": { es: "Guardar", de: "Speichern", fr: "Enregistrer", ja: "保存", ko: "저장", pt: "Salvar" },
  "Apply": { es: "Aplicar", de: "Anwenden", fr: "Appliquer", ja: "適用", ko: "적용", pt: "Aplicar" },
  "Delete": { es: "Eliminar", de: "Löschen", fr: "Supprimer", ja: "削除", ko: "삭제", pt: "Excluir" },
  "Calculate plan": {
    es: "Calcular carga", de: "Ladeplan berechnen", fr: "Calculer le plan",
    ja: "積載を計算", ko: "적재 계산", pt: "Calcular carga",
  },
  "Calculate loading": {
    es: "Calcular carga", de: "Beladung berechnen", fr: "Calculer le chargement",
    ja: "積載プランを計算", ko: "적재 계획 계산", pt: "Calcular carregamento",
  },
  "Calculate pallets": {
    es: "Calcular palets", de: "Paletten berechnen", fr: "Calculer les palettes",
    ja: "パレットを計算", ko: "팔레트 계산", pt: "Calcular paletes",
  },

  // Step 1: Container & Loading Method
  "Choose a container and loading method": {
    es: "Elige un contenedor y el método de carga",
    de: "Container und Beladungsmethode wählen",
    fr: "Choisissez un conteneur et une méthode de chargement",
    ja: "コンテナと積載方式を選択",
    ko: "컨테이너 및 적재 방식 선택",
    pt: "Escolha um contêiner e o método de carga",
  },
  "Select a container or vehicle and choose how to prepare the cargo.": {
    es: "Selecciona un contenedor o vehículo y define cómo preparar la carga.",
    de: "Wählen Sie einen Container oder ein Fahrzeug und die Vorbereitungsart.",
    fr: "Sélectionnez un conteneur ou véhicule et le mode de préparation.",
    ja: "コンテナまたは車両を選び、貨物の積載方法を指定します。",
    ko: "컨테이너 또는 차량을 선택하고 화물 적재 방식을 지정하세요.",
    pt: "Selecione um contêiner ou veículo e escolha como preparar a carga.",
  },
  "Container or vehicle": {
    es: "Contenedor o vehículo", de: "Container / Fahrzeug", fr: "Conteneur ou véhicule",
    ja: "コンテナ・車両", ko: "컨테이너 또는 차량", pt: "Contêiner ou veículo",
  },
  "Space library": {
    es: "Biblioteca", de: "Bibliothek", fr: "Bibliothèque",
    ja: "スペース一覧", ko: "규격 라이브러리", pt: "Biblioteca",
  },
  "Space preset": {
    es: "Tipo predefinido", de: "Standard-Typ", fr: "Modèle prédéfini",
    ja: "コンテナ規格", ko: "컨테이너 규격", pt: "Modelo padrão",
  },
  "Interior, door and payload": {
    es: "Interior, puerta y carga útil", de: "Innenmaße, Tür & Nutzlast", fr: "Intérieur, porte et charge utile",
    ja: "内寸・ドア・最大積載量", ko: "내부 치수, 도어 및 최대 하중", pt: "Interior, porta e carga útil",
  },
  "How will you load the cargo?": {
    es: "¿Cómo cargarás la mercancía?", de: "Wie wird die Fracht geladen?", fr: "Comment charger la marchandise ?",
    ja: "貨物の積載方式", ko: "화물 적재 방식 선택", pt: "Como carregar a mercadoria?",
  },
  "Palletize then load": {
    es: "Paletizar y cargar", de: "Palettieren & laden", fr: "Palettiser puis charger",
    ja: "パレット積載後にコンテナ投入", ko: "팔레트 적재 후 컨테이너 선적", pt: "Paletizar e carregar",
  },
  "Palletize all cargo or mix pallets with selected loose cartons": {
    es: "Paletiza toda la carga o mezcla palets con cajas sueltas seleccionadas",
    de: "Alles palettieren oder Paletten mit ausgewählten losen Kartons mischen",
    fr: "Palettisez tout ou mixez palettes et cartons en vrac",
    ja: "全貨物をパレット化、またはパレットとバラ積みを混載",
    ko: "전체 팔레트화 또는 팔레트와 일부 벌크 박스 혼적",
    pt: "Paletize toda a carga ou misture paletes com caixas soltas",
  },
  "Load loose cartons": {
    es: "Cargar cajas sueltas", de: "Lose Kartons laden", fr: "Charger en vrac",
    ja: "バラ積み（直接積載）", ko: "벌크 적재 (직접 선적)", pt: "Carregar caixas soltas",
  },
  "Place ordered cartons directly in the container": {
    es: "Coloca las cajas directamente en el contenedor",
    de: "Kartons direkt im Container platzieren",
    fr: "Placez les cartons directement dans le conteneur",
    ja: "カートンをコンテナへ直接配置します",
    ko: "주문 박스를 컨테이너에 직접 적재합니다",
    pt: "Coloque as caixas diretamente no contêiner",
  },
  "Palletize only": {
    es: "Solo paletizar", de: "Nur palettieren", fr: "Palettiser uniquement",
    ja: "パレット積載のみ", ko: "팔레트 적재만", pt: "Apenas paletizar",
  },
  "Plan pallet contents and total units": {
    es: "Planifica el contenido y total de palets",
    de: "Paletteninhalt und Gesamtanzahl planen",
    fr: "Planifiez le contenu et le nombre de palettes",
    ja: "パレット内の配置と総パレット数を計算",
    ko: "팔레트 구성 및 총 팔레트 수량 계획",
    pt: "Planeje o conteúdo e o total de paletes",
  },
  "Single-product capacity": {
    es: "Capacidad de un producto", de: "Einzelprodukt-Kapazität", fr: "Capacité mono-produit",
    ja: "単品最大積載数", ko: "단일 품목 최대 적재", pt: "Capacidade de produto único",
  },
  "Estimate capacity for one product": {
    es: "Calcula el máximo para un solo SKU",
    de: "Maximale Menge für ein Produkt schätzen",
    fr: "Estimez la capacité maximale pour un seul produit",
    ja: "1品目の最大積載可能数を試算",
    ko: "단일 품목의 최대 적재 수량 산출",
    pt: "Estime a capacidade máxima de um produto",
  },
  "Obstacles, accessories and weight distribution": {
    es: "Obstáculos, accesorios y reparto de peso",
    de: "Hindernisse, Zubehör & Gewichtsverteilung",
    fr: "Obstacles, accessoires et répartition du poids",
    ja: "障害物・付属品・重量配分",
    ko: "장애물, 부속품 및 하중 배분",
    pt: "Obstáculos, acessórios e distribuição de peso",
  },
  "Physical model": { es: "Modelo 3D", de: "3D-Modell", fr: "Modèle 3D", ja: "立体モデル", ko: "실물 모델", pt: "Modelo 3D" },
  "Wireframe": { es: "Alambre", de: "Drahtgitter", fr: "Filaire", ja: "ワイヤー", ko: "와이어프레임", pt: "Arame" },
  "Dimensions": { es: "Cotas", de: "Maße", fr: "Dimensions", ja: "寸法", ko: "치수", pt: "Dimensões" },
  "Transparency": { es: "Opacidad", de: "Transparenz", fr: "Transparence", ja: "透過", ko: "투명도", pt: "Transparência" },
  "Rear Door Safety Clearance (mm)": {
    es: "Holgura puerta trasera (mm)", de: "Tür-Sicherheitsabstand (mm)", fr: "Marge porte arrière (mm)",
    ja: "ドア側安全クリアランス (mm)", ko: "후면 도어 안전 여유 (mm)", pt: "Folga de porta traseira (mm)",
  },
  "Road Weight Limit Preset": {
    es: "Límite de peso en carretera", de: "Straßengewichtsgrenze", fr: "Limite de poids routier",
    ja: "道路重量制限プリセット", ko: "도로 중량 제한 프리셋", pt: "Limite de peso rodoviário",
  },

  // Step 2: Packaging
  "Choose pallet or packaging setup": {
    es: "Configura palets o embalaje", de: "Paletten- & Verpackungs-Setup", fr: "Configurer les palettes et emballages",
    ja: "パレット・梱包仕様の設定", ko: "팔레트 및 포장 설정", pt: "Configurar paletes ou embalagem",
  },
  "Pallet length": { es: "Largo palet", de: "Palettenlänge", fr: "Longueur palette", ja: "パレット長", ko: "팔레트 길이", pt: "Compr. palete" },
  "Pallet width": { es: "Ancho palet", de: "Palettenbreite", fr: "Largeur palette", ja: "パレット幅", ko: "팔레트 너비", pt: "Largura palete" },
  "Base height": { es: "Altura base", de: "Basishöhe", fr: "Hauteur base", ja: "ベース高", ko: "베이스 높이", pt: "Altura base" },
  "Pallet tare": { es: "Tara palet", de: "Palettentara", fr: "Tare palette", ja: "パレット自重", ko: "팔레트 자중", pt: "Tara palete" },
  "Payload per pallet": { es: "Carga por palet", de: "Traglast/Palette", fr: "Charge/palette", ja: "最大積載/パレット", ko: "팔레트당 하중", pt: "Carga por palete" },
  "Pallet count": { es: "Nº palets", de: "Palettenanzahl", fr: "Nb palettes", ja: "パレット数", ko: "팔레트 수량", pt: "Qtd. paletes" },
  "Pallet gap": { es: "Espacio palet", de: "Palettenabstand", fr: "Écart palette", ja: "パレット間隔", ko: "팔레트 간격", pt: "Espaço palete" },
  "Cargo height above deck": {
    es: "Altura carga sobre palet", de: "Ladehöhe über Palette", fr: "Hauteur charge sur palette",
    ja: "パレット上貨物高さ上限", ko: "팔레트 위 화물 높이 제한", pt: "Altura da carga no palete",
  },
  "Floor pallet pattern": {
    es: "Patrón de palets en suelo", de: "Boden-Palettenmuster", fr: "Disposition des palettes",
    ja: "床面パレット配置方式", ko: "바닥 팔레트 배치 패턴", pt: "Padrão de paletes no piso",
  },
  "Pinwheel (Interlocking 90°)": {
    es: "Molinete (90° entrelazado)", de: "Windrad (90° verzahnt)", fr: "Moulinet (90° imbriqué)",
    ja: "ピンホイール（90°交互配置）", ko: "핀휠 (90° 교차 배치)", pt: "Catavento (90° alternado)",
  },

  // Step 3: Cargo & Smart Paste
  "Enter cargo": { es: "Ingresar carga", de: "Fracht eingeben", fr: "Saisir la marchandise", ja: "貨物を入力", ko: "화물 입력", pt: "Inserir carga" },
  "Add SKU": { es: "Añadir SKU", de: "SKU hinzufügen", fr: "Ajouter SKU", ja: "SKU追加", ko: "SKU 추가", pt: "Adicionar SKU" },
  "Color": { es: "Color", de: "Farbe", fr: "Couleur", ja: "色", ko: "색상", pt: "Cor" },
  "Settings": { es: "Ajustes", de: "Optionen", fr: "Réglages", ja: "設定", ko: "설정", pt: "Ajustes" },
  "SKU / Name": { es: "SKU / Nombre", de: "SKU / Name", fr: "SKU / Nom", ja: "SKU / 品名", ko: "SKU / 품명", pt: "SKU / Nome" },
  "Length": { es: "Largo", de: "Länge", fr: "Longueur", ja: "長さ", ko: "길이", pt: "Compr." },
  "Width": { es: "Ancho", de: "Breite", fr: "Largeur", ja: "幅", ko: "너비", pt: "Largura" },
  "Height": { es: "Alto", de: "Höhe", fr: "Hauteur", ja: "高さ", ko: "높이", pt: "Altura" },
  "Weight": { es: "Peso", de: "Gewicht", fr: "Poids", ja: "重量", ko: "중량", pt: "Peso" },
  "Quantity": { es: "Cant.", de: "Menge", fr: "Qté", ja: "数量", ko: "수량", pt: "Qtd." },
  "Gross weight": { es: "Peso bruto", de: "Bruttogewicht", fr: "Poids brut", ja: "総重量", ko: "총중량", pt: "Peso bruto" },
  "Required boxes": { es: "Cajas requeridas", de: "Benötigte Kartons", fr: "Cartons requis", ja: "必要箱数", ko: "필요 박스", pt: "Caixas necessárias" },
  "Orientation": { es: "Orientación", de: "Ausrichtung", fr: "Orientation", ja: "向き", ko: "회전", pt: "Orientação" },
  "Priority": { es: "Prioridad", de: "Priorität", fr: "Priorité", ja: "優先度", ko: "우선순위", pt: "Prioridade" },
  "Floor only": { es: "Solo suelo", de: "Nur Boden", fr: "Sol uniquement", ja: "底面のみ", ko: "바닥 전용", pt: "Apenas piso" },
  "Import CSV / Excel": {
    es: "Importar CSV / Excel", de: "CSV / Excel importieren", fr: "Importer CSV / Excel",
    ja: "CSV / Excel 取込", ko: "CSV / Excel 가져오기", pt: "Importar CSV / Excel",
  },
  "Excel template": {
    es: "Plantilla Excel", de: "Excel-Vorlage", fr: "Modèle Excel",
    ja: "Excelテンプレート", ko: "Excel 템플릿", pt: "Modelo Excel",
  },
  "Smart Paste & File Import (Excel / CSV / WeChat)": {
    es: "Pegado Inteligente e Importación (Excel / CSV)",
    de: "Smart-Einfügen & Datei-Import (Excel / CSV)",
    fr: "Collage Intelligent & Import (Excel / CSV)",
    ja: "スマート貼付・ファイル取込 (Excel / CSV)",
    ko: "스마트 붙여넣기 및 파일 가져오기 (Excel / CSV)",
    pt: "Colagem Inteligente e Importação (Excel / CSV)",
  },
  "Drop .xlsx / .csv here, or click to select file": {
    es: "Arrastra .xlsx / .csv aquí o haz clic para seleccionar",
    de: ".xlsx / .csv hierher ziehen oder Datei auswählen",
    fr: "Déposez .xlsx / .csv ici ou cliquez pour choisir",
    ja: ".xlsx / .csv をドロップ、またはクリックして選択",
    ko: ".xlsx / .csv 파일을 드래그하거나 클릭하여 선택",
    pt: "Arraste .xlsx / .csv aqui ou clique para selecionar",
  },
  "Replace existing list": {
    es: "Reemplazar lista actual", de: "Aktuelle Liste ersetzen", fr: "Remplacer la liste",
    ja: "既存リストを置換", ko: "기존 목록 대체", pt: "Substituir lista atual",
  },
  "Append as new rows": {
    es: "Añadir como nuevas filas", de: "Als neue Zeilen anhängen", fr: "Ajouter à la suite",
    ja: "新規行として追加", ko: "새 행으로 추가", pt: "Adicionar como novas linhas",
  },
  "Confirm Import": {
    es: "Confirmar importación", de: "Import bestätigen", fr: "Confirmer l'import",
    ja: "インポート確定", ko: "가져오기 확인", pt: "Confirmar importação",
  },
  "Clear": { es: "Limpiar", de: "Leeren", fr: "Effacer", ja: "クリア", ko: "지우기", pt: "Limpar" },
  "Dimension unit": { es: "Unidad de dimensión", de: "Längeneinheit", fr: "Unité de dimension", ja: "寸法単位", ko: "치수 단위", pt: "Unidade de medida" },

  // Step 4, 5, 6
  "Layout and orientation": {
    es: "Disposición y orientación", de: "Layout und Ausrichtung", fr: "Disposition et orientation",
    ja: "配置と向きルール", ko: "배치 및 회전 규칙", pt: "Layout e orientação",
  },
  "Auto rotate (horiz.)": {
    es: "Rotación horiz.", de: "Horiz. drehen", fr: "Rotation horiz.",
    ja: "水平自動回転", ko: "수평 자동 회전", pt: "Rotação horiz.",
  },
  "Any rotation": {
    es: "Cualquier rotación", de: "Beliebig drehen", fr: "Toute rotation",
    ja: "6方向すべて可", ko: "모든 방향 허용", pt: "Qualquer rotação",
  },
  "Loading rules": {
    es: "Reglas de carga", de: "Laderegeln", fr: "Règles de chargement",
    ja: "積載ルール", ko: "적재 규칙", pt: "Regras de carga",
  },
  "Review and calculate": {
    es: "Revisar y calcular", de: "Prüfen und berechnen", fr: "Vérifier et calculer",
    ja: "入力確認と計算", ko: "검토 및 계산", pt: "Revisar e calcular",
  },
  "Automatic layout": { es: "Layout automático", de: "Automatisches Layout", fr: "Disposition auto", ja: "自動配置", ko: "자동 배치", pt: "Layout automático" },
  "Depth first": { es: "Profundidad primero", de: "Tiefe zuerst", fr: "Profondeur d'abord", ja: "奥行き優先", ko: "깊이 우선", pt: "Profundidade primeiro" },
  "Layer by layer": { es: "Capa por capa", de: "Schicht für Schicht", fr: "Couche par couche", ja: "層ごと積載", ko: "층별 적재", pt: "Camada por camada" },
  "Clearance": { es: "Holgura", de: "Abstand", fr: "Marge", ja: "クリアランス", ko: "여유 공간", pt: "Folga" },

  // Step 7: Results & Exports
  "Plan results": { es: "Resultados del plan", de: "Ladeplan-Ergebnisse", fr: "Résultats du plan", ja: "積載プラン結果", ko: "적재 계획 결과", pt: "Resultados do plano" },
  "Volume utilization": { es: "Uso de volumen", de: "Volumenauslastung", fr: "Taux de volume", ja: "容積利用率", ko: "부피 적재율", pt: "Uso de volume" },
  "Payload utilization": { es: "Uso de peso", de: "Gewichtsauslastung", fr: "Taux de poids", ja: "重量利用率", ko: "중량 적재율", pt: "Uso de peso" },
  "Loaded items": { es: "Cajas cargadas", de: "Geladene Kartons", fr: "Colis chargés", ja: "積載数", ko: "적재 수량", pt: "Itens carregados" },
  "Loaded volume": { es: "Volumen cargado", de: "Geladenes Volumen", fr: "Volume chargé", ja: "積載容積", ko: "적재 부피", pt: "Volume carregado" },
  "Loaded weight": { es: "Peso cargado", de: "Geladenes Gewicht", fr: "Poids chargé", ja: "積載重量", ko: "적재 중량", pt: "Peso carregado" },
  "Loaded gross weight": { es: "Peso bruto cargado", de: "Bruttogewicht", fr: "Poids brut chargé", ja: "積載総重量", ko: "적재 총중량", pt: "Peso bruto carregado" },
  "Remaining volume": { es: "Volumen libre", de: "Restvolumen", fr: "Volume restant", ja: "残余容積", ko: "잔여 부피", pt: "Volume restante" },
  "Remaining payload": { es: "Carga útil libre", de: "Restnutzlast", fr: "Charge restante", ja: "残余積載量", ko: "잔여 하중", pt: "Carga restante" },
  "Independent validation": { es: "Validación independiente", de: "Unabhängige Prüfung", fr: "Validation indépendante", ja: "独立検証", ko: "독립 검증", pt: "Validação independente" },
  "All checks passed": { es: "Todo verificado", de: "Alle Prüfungen bestanden", fr: "Tout est validé", ja: "全項目合格", ko: "모든 검증 통과", pt: "Tudo aprovado" },
  "Export plan": { es: "Exportar plan", de: "Plan exportieren", fr: "Exporter le plan", ja: "プラン出力", ko: "계획 내보내기", pt: "Exportar plano" },
  "Download PDF": { es: "Descargar PDF", de: "PDF herunterladen", fr: "Télécharger PDF", ja: "PDF保存", ko: "PDF 다운로드", pt: "Baixar PDF" },
  "Save image": { es: "Guardar imagen", de: "Bild speichern", fr: "Enregistrer image", ja: "画像保存", ko: "이미지 저장", pt: "Salvar imagem" },
  "Practical plan": { es: "Plan práctico", de: "Praxis-Plan", fr: "Plan pratique", ja: "現場実用プラン", ko: "현장 실용 플랜", pt: "Plano prático" },
  "High-density search": { es: "Alta densidad", de: "Hohe Dichte", fr: "Haute densité", ja: "高密度探索", ko: "고밀도 탐색", pt: "Alta densidade" },

  // Trade Pro Workbench (M1-M7)
  "Trade Pro Workbench (Gap-Fill · Carton Opt · Multi-Container · Compliance)": {
    es: "Mesa Pro Comercio Exterior (Relleno · Optimización · Multi-Contenedor · Cumplimiento)",
    de: "Außenhandels-Pro-Workbench (Nachfüllen · Karton-Opt · Multi-Container · Compliance)",
    fr: "Atelier Export Pro (Complément · Optim. Carton · Multi-Conteneurs · Conformité)",
    ja: "貿易プロ・ワークベンチ（隙間補填・外箱最適化・複数コンテナ・コンプライアンス）",
    ko: "무역 프로 워크벤치 (빈공간 채우기 · 박스 최적화 · 다중 컨테이너 · 규정 검토)",
    pt: "Painel Pro Comércio Exterior (Completar Carga · Otim. Caixa · Multi-Contêiner · Conformidade)",
  },
  "Gap-Fill Top-Up": { es: "Relleno de Huecos", de: "Restraum-Nachfüllen", fr: "Complément de Charge", ja: "隙間補填・追加発注", ko: "빈공간 추가 적재", pt: "Completar Carga" },
  "Carton Size Optimizer": { es: "Optimizador de Cajas", de: "Karton-Optimierer", fr: "Optimiseur de Cartons", ja: "外箱サイズ最適化", ko: "외박스 치수 최적화", pt: "Otimizador de Caixas" },
  "Multi-Container & Freight": { es: "Multi-Contenedor y Flete", de: "Multi-Container & Fracht", fr: "Multi-Conteneurs & Fret", ja: "複数コンテナ・運賃按分", ko: "다중 컨테이너 및 운임", pt: "Multi-Contêiner e Frete" },
  "Compliance & Dunnage": { es: "Cumplimiento y Estiba", de: "Compliance & Staumaterial", fr: "Conformité & Calage", ja: "法令・緩衝材BOM", ko: "규정 및 완충재 BOM", pt: "Conformidade e Peação" },
  "FCL vs LCL & Trade Advisory": { es: "FCL vs LCL y Asesoría", de: "FCL vs. LCL & Beratung", fr: "FCL vs LCL & Conseil", ja: "FCL/LCL比較・貿易助言", ko: "FCL/LCL 비교 및 자문", pt: "FCL vs LCL e Consultoria" },
  "Apply Quantities & Recalculate": {
    es: "Aplicar cantidades y recalcular", de: "Mengen übernehmen & neu berechnen", fr: "Appliquer et recalculer",
    ja: "数量を反映して再計算", ko: "수량 반영 및 재계산", pt: "Aplicar quantidades e recalcular",
  },
  "Export Standard Packing List (Excel)": {
    es: "Exportar Packing List (Excel)", de: "Packliste exportieren (Excel)", fr: "Exporter Packing List (Excel)",
    ja: "標準パッキングリスト出力 (Excel)", ko: "표준 패킹리스트 내보내기 (Excel)", pt: "Exportar Packing List (Excel)",
  },
  "Export Freight Split (Excel)": {
    es: "Exportar Reparto de Flete (Excel)", de: "Frachtaufteilung exportieren (Excel)", fr: "Exporter Répartition Fret (Excel)",
    ja: "運賃按分表出力 (Excel)", ko: "운임 배분표 내보내기 (Excel)", pt: "Exportar Rateio de Frete (Excel)",
  },
  "Export CI + PL + Dunnage Bundle (Excel)": {
    es: "Exportar Pack CI + PL + Estiba (Excel)", de: "CI + PL + Staumaterial Paket (Excel)", fr: "Exporter Pack CI + PL + Calage (Excel)",
    ja: "CI+PL+緩衝材3点セット出力 (Excel)", ko: "CI+PL+완충재 통합본 내보내기 (Excel)", pt: "Exportar Pacote CI + PL + Peação (Excel)",
  },
  "Account-Free Crew View (Scan on Any Phone)": {
    es: "Vista de Almacén sin Cuenta (Escanear en Móvil)",
    de: "Konto-freie Lageransicht (Per Handy scannen)",
    fr: "Vue Entrepôt sans Compte (Scanner sur Mobile)",
    ja: "ログイン不要・現場スマホ積載ガイド (Crew View)",
    ko: "로그인 없는 현장 모바일 적재 가이드 (Crew View)",
    pt: "Visão de Armazém sem Conta (Escanear no Celular)",
  },
  "Generate Warehouse QR & Link": {
    es: "Generar QR y enlace de almacén", de: "Lager-QR & Link erzeugen", fr: "Générer QR & lien entrepôt",
    ja: "現場QRコードとリンクを生成", ko: "현장 QR 및 링크 생성", pt: "Gerar QR e link do armazém",
  },
  "Open Crew View": {
    es: "Abrir vista de almacén", de: "Lageransicht öffnen", fr: "Ouvrir vue entrepôt",
    ja: "現場ガイドを開く", ko: "현장 가이드 열기", pt: "Abrir visão de armazém",
  },
  "Copy Link": { es: "Copiar enlace", de: "Link kopieren", fr: "Copier le lien", ja: "リンクをコピー", ko: "링크 복사", pt: "Copiar link" },
  "Copied!": { es: "¡Copiado!", de: "Kopiert!", fr: "Copié !", ja: "コピーしました", ko: "복사됨!", pt: "Copiado!" },
  "Recommended Option": { es: "Opción recomendada", de: "Empfohlene Option", fr: "Option recommandée", ja: "推奨プラン", ko: "추천 옵션", pt: "Opção recomendada" },
  "20GP Break-Even": { es: "Punto equilibrio 20GP", de: "20GP Break-Even", fr: "Seuil 20GP", ja: "20GP 損益分岐点", ko: "20GP 손익분기점", pt: "Equilíbrio 20GP" },
  "Client Confirmation Email": {
    es: "Correo de confirmación al cliente", de: "Kunden-Bestätigungs-E-Mail", fr: "E-mail de confirmation client",
    ja: "顧客向け確認メール文面", ko: "고객 확인 이메일 템플릿", pt: "E-mail de confirmação ao cliente",
  },
  "Copy Email": { es: "Copiar correo", de: "E-Mail kopieren", fr: "Copier l'e-mail", ja: "メールをコピー", ko: "이메일 복사", pt: "Copiar e-mail" },

  // Crew View (/crew)
  "CargoFit Crew Loading Sheet": {
    es: "Hoja de Carga de Almacén CargoFit", de: "CargoFit Lager-Verladeplan", fr: "Fiche de Chargement Entrepôt CargoFit",
    ja: "CargoFit 現場積載指示書", ko: "CargoFit 현장 적재 지시서", pt: "Folha de Carregamento CargoFit",
  },
  "Step-by-Step Row Loading Checklist (Deepest Wall → Door)": {
    es: "1. Lista paso a paso por fila (Fondo → Puerta)",
    de: "1. Reihen-Checkliste (Rückwand → Tür)",
    fr: "1. Liste de chargement par rangée (Fond → Porte)",
    ja: "1. 列ごとの積載チェックリスト（奥壁 → ドア側）",
    ko: "1. 열별 순차 적재 체크리스트 (안쪽 벽 → 도어)",
    pt: "1. Checklist passo a passo por fileira (Fundo → Porta)",
  },
  "Five-Photo Watermark Proof (Print Inspection Report)": {
    es: "2. 5 Fotos con Marca de Agua (Informe de Inspección)",
    de: "2. 5-Foto-Nachweis mit Wasserzeichen (Prüfbericht)",
    fr: "2. 5 Photos Horodatées (Rapport d'Inspection)",
    ja: "2. 5点写真スタンプ記録（検品レポート印刷）",
    ko: "2. 5단계 워터마크 사진 기록 (검수 보고서 인쇄)",
    pt: "2. 5 Fotos com Marca d'Água (Relatório de Inspeção)",
  },
  "Loaded": { es: "Cargado", de: "Verladen", fr: "Chargé", ja: "積込済", ko: "적재 완료", pt: "Carregado" },
  "Print / Save PDF Inspection Report": {
    es: "Imprimir / Guardar PDF de Inspección", de: "Prüfbericht drucken / als PDF speichern", fr: "Imprimer / Enregistrer le PDF",
    ja: "検品レポートを印刷 / PDF保存", ko: "검수 보고서 인쇄 / PDF 저장", pt: "Imprimir / Salvar Relatório PDF",
  },
  "Back to CargoFit Workspace": {
    es: "Volver al espacio de trabajo CargoFit", de: "Zurück zum CargoFit-Arbeitsbereich", fr: "Retour à l'espace CargoFit",
    ja: "CargoFit ワークスペースへ戻る", ko: "CargoFit 워크스페이스로 돌아가기", pt: "Voltar ao painel CargoFit",
  },
  "No valid shared loading plan detected. Generate a QR code from Step 7 in CargoFit first.": {
    es: "No se detectó ningún plan compartido válido. Genera un código QR desde el Paso 7 en CargoFit.",
    de: "Kein gültiger Ladeplan gefunden. Bitte erstellen Sie zuerst einen QR-Code in Schritt 7.",
    fr: "Aucun plan partagé valide détecté. Générez d'abord un QR code à l'étape 7 dans CargoFit.",
    ja: "有効な共有プランが見つかりません。CargoFit のステップ7からQRコードを生成してください。",
    ko: "유효한 공유 적재 데이터가 없습니다. CargoFit 7단계에서 QR 코드를 먼저 생성하세요.",
    pt: "Nenhum plano compartilhado válido detectado. Gere um QR code no Passo 7 do CargoFit.",
  },

  // Landing Page (/landing)
  "3D Container Loading & Trade Document Workspace for Exporters, Merchandisers & Warehouses": {
    es: "Plataforma 3D de Carga de Contenedores y Documentación para Comercio Exterior y Almacenes",
    de: "3D-Container-Ladeplanung & Export-Dokumentation für Handel, Einkauf und Lager",
    fr: "Plateforme 3D de Chargement Conteneur & Documents Export pour Négociants et Entrepôts",
    ja: "貿易営業・生産管理・倉庫現場のための3Dコンテナ積載＆書類連携プラットフォーム",
    ko: "무역 영업·머천다이저·물류 현장을 위한 3D 컨테이너 적재 및 서류 협업 플랫폼",
    pt: "Plataforma 3D de Carregamento de Contêineres e Documentos para Exportação e Armazéns",
  },
  "Paste Excel orders in 3 seconds. Mix pallets and loose cartons, auto-fill container gaps, optimize master cartons, enforce road weight limits, split LIFO freight, export formula Packing Lists, and scan Crew View on any phone.": {
    es: "Pega pedidos de Excel en 3 segundos. Mezcla palets y cajas sueltas, rellena huecos, optimiza cajas máster, controla peso en carretera, divide fletes LIFO, exporta Packing Lists y escanea Crew View en cualquier móvil.",
    de: "Excel-Bestellungen in 3 Sekunden einfügen. Paletten & lose Kartons mischen, Restraum füllen, Umkartons optimieren, Achslasten prüfen, LIFO-Fracht aufteilen, Packlisten exportieren & mobil im Lager scannen.",
    fr: "Collez vos commandes Excel en 3 secondes. Mixez palettes et vrac, comblez les vides, optimisez vos cartons, contrôlez le poids routier, répartissez le fret LIFO, exportez vos Packing Lists et scannez sur mobile.",
    ja: "Excel注文を3秒で貼付。パレットとバラ積みの混載、隙間補填、外箱最適化、道路重量制限、LIFO運賃按分、数式付きパッキングリスト出力、スマホ現場積載ガイドまで一貫対応。",
    ko: "엑셀 주문을 3초 만에 붙여넣기. 팔레트·벌크 혼적, 빈공간 추가 발주, 외박스 최적화, 도로 중량 제한, LIFO 운임 배분, 표준 패킹리스트 엑셀 및 모바일 현장 스캔까지 한 번에 해결하세요.",
    pt: "Cole pedidos do Excel em 3 segundos. Misture paletes e caixas soltas, complete espaços vazios, otimize caixas master, controle peso rodoviário, rateie frete LIFO, exporte Packing Lists e escaneie no celular.",
  },
  "Launch Free Load Planner →": {
    es: "Abrir Planificador Gratis →", de: "Kostenlos starten →", fr: "Ouvrir l'outil gratuit →",
    ja: "無料で積載計算を始める →", ko: "무료 적재 플래너 시작 →", pt: "Abrir Planejador Grátis →",
  },
  "Start Planning Free": {
    es: "Empezar gratis ahora", de: "Jetzt kostenlos planen", fr: "Commencer gratuitement",
    ja: "今すぐ無料で計算", ko: "지금 무료로 계산하기", pt: "Começar gratuitamente",
  },
  "Crew View": {
    es: "Vista Almacén", de: "Lageransicht", fr: "Vue Entrepôt",
    ja: "現場ガイド", ko: "현장 가이드", pt: "Visão Armazém",
  },
  "Export Sales: Fill Every Cubic Meter": {
    es: "Ventas Exportación: Aprovecha Cada m³", de: "Exportvertrieb: Jeden m³ auslasten", fr: "Ventes Export : Remplissez Chaque m³",
    ja: "貿易営業：隙間を埋めて受注単価アップ", ko: "무역 영업: 빈공간 채워 추가 수주", pt: "Vendas Exportação: Aproveite Cada m³",
  },
  "Calculate exact top-up cartons for unused space and generate multilingual client upsell emails plus landed freight breakdowns.": {
    es: "Calcula cajas adicionales exactas para el espacio libre y genera correos multilingües de reposición y desgloses de flete.",
    de: "Berechnet exakte Nachfüll-Kartons für freien Raum und erstellt mehrsprachige Kunden-E-Mails samt Frachtaufteilung.",
    fr: "Calcule les cartons complémentaires exacts et génère des e-mails clients multilingues avec répartition du fret.",
    ja: "余剰スペースに入る正確な追加箱数を自動算出し、多言語の顧客提案メールと運賃按分表を即作成。",
    ko: "남은 공간에 들어갈 정확한 추가 박스 수를 계산하고 다국어 고객 제안 메일과 운임 배분표를 즉시 생성합니다.",
    pt: "Calcula caixas extras exatas para o espaço livre e gera e-mails multilíngues e rateio de frete por SKU.",
  },
  "Merchandisers: 3-Second Import to Packing List": {
    es: "Operaciones: De Excel a Packing List en 3s", de: "Disposition: In 3s zur Packliste", fr: "ADV Export : De l'Excel à la Packing List en 3s",
    ja: "生産・出荷管理：3秒取込から書類出力まで", ko: "무역 서류: 3초 입력부터 패킹리스트까지", pt: "Operações: Do Excel ao Packing List em 3s",
  },
  "Ctrl+V any customer table, catch door-height blockers upfront, optimize carton sizes, and export formula-driven Packing Lists.": {
    es: "Pega cualquier tabla con Ctrl+V, detecta bloqueos de puerta antes de calcular, optimiza cajas y exporta Packing Lists con fórmulas.",
    de: "Beliebige Kundentabellen per Strg+V einfügen, Türhöhe vorab prüfen, Kartons optimieren und Excel-Packlisten mit Formeln exportieren.",
    fr: "Collez tout tableau client par Ctrl+V, anticipez les blocages de porte, optimisez vos cartons et exportez vos Packing Lists avec formules.",
    ja: "任意の顧客表を貼り付けるだけでドア高干渉を事前警告。外箱最適化と数式入りExcelパッキングリストを一括出力。",
    ko: "고객 엑셀표를 붙여넣기만 하면 도어 간섭 사전 경고, 박스 치수 최적화, 수식 포함 패킹리스트를 바로 출력합니다.",
    pt: "Cole qualquer tabela com Ctrl+V, detecte bloqueios de porta antes do cálculo, otimize caixas e exporte Packing Lists com fórmulas.",
  },
  "Warehouse Crew: Scan & Load Row by Row": {
    es: "Almacén: Escanea y Carga Fila por Fila", de: "Lagerteam: Scannen & Reihe für Reihe laden", fr: "Entrepôt : Scannez et Chargez Rangée par Rangée",
    ja: "工場・倉庫現場：QRスキャンで列ごとに積込", ko: "물류 현장: QR 스캔으로 열별 순차 적재", pt: "Armazém: Escaneie e Carregue Fileira por Fileira",
  },
  "Open large-print row slices on any phone without login, check off rows, stamp 5 inspection photos, and print the loading report.": {
    es: "Abre filas en letra grande en cualquier móvil sin registro, marca avances, sella 5 fotos de inspección e imprime el informe.",
    de: "Öffnet große Reihen-Karten ohne Login auf jedem Handy, hakt Reihen ab, stempelt 5 Prüffotos und druckt den Verladebericht.",
    fr: "Ouvrez des fiches grand format sur mobile sans compte, cochez les rangées, horodatez 5 photos et imprimez le rapport.",
    ja: "ログイン不要でスマホに大文字の列別手順を表示。チェック完了・5点写真スタンプ・検品レポート印刷まで完結。",
    ko: "로그인 없이 스마트폰에서 큰 글씨 열별 가이드를 열고, 5단계 워터마크 사진 촬영 및 검수 보고서 인쇄까지 완료하세요.",
    pt: "Abra instruções grandes no celular sem login, marque fileiras, carimbe 5 fotos de inspeção e imprima o relatório.",
  },
  // Secondary Step 3 / Mobile / Crew strings
  "Order cartons": { es: "Cajas del pedido", de: "Auftragskartons", fr: "Cartons de la commande", ja: "注文カートン", ko: "주문 박스 목록", pt: "Caixas do pedido" },
  "Spreadsheet options": { es: "Opciones de tabla", de: "Tabellenoptionen", fr: "Options tableau", ja: "表オプション", ko: "표 옵션", pt: "Opções da tabela" },
  "Examples and actual records": { es: "Ejemplos y registros", de: "Beispiele & Daten", fr: "Exemples et relevés", ja: "サンプル・実績", ko: "예시 및 실측 기록", pt: "Exemplos e registros" },
  "Show detailed rules": { es: "Ver reglas detalladas", de: "Detailregeln zeigen", fr: "Voir règles détaillées", ja: "詳細ルールを表示", ko: "상세 규칙 보기", pt: "Ver regras detalhadas" },
  "Packaging input units": { es: "Unidades de entrada", de: "Eingabeeinheiten", fr: "Unités de saisie", ja: "入力単位", ko: "입력 단위", pt: "Unidades de entrada" },
  "Millimeters (mm)": { es: "Milímetros (mm)", de: "Millimeter (mm)", fr: "Millimètres (mm)", ja: "ミリメートル (mm)", ko: "밀리미터 (mm)", pt: "Milímetros (mm)" },
  "Centimeters (cm)": { es: "Centímetros (cm)", de: "Zentimeter (cm)", fr: "Centimètres (cm)", ja: "センチメートル (cm)", ko: "센티미터 (cm)", pt: "Centímetros (cm)" },
  "Inches (in)": { es: "Pulgadas (in)", de: "Zoll (in)", fr: "Pouces (in)", ja: "インチ (in)", ko: "인치 (in)", pt: "Polegadas (in)" },
  "Kilograms (kg)": { es: "Kilogramos (kg)", de: "Kilogramm (kg)", fr: "Kilogrammes (kg)", ja: "キログラム (kg)", ko: "킬로그램 (kg)", pt: "Quilogramas (kg)" },
  "Pounds (lb)": { es: "Libras (lb)", de: "Pfund (lb)", fr: "Livres (lb)", ja: "ポンド (lb)", ko: "파운드 (lb)", pt: "Libras (lb)" },
  "Progress": { es: "Progreso", de: "Fortschritt", fr: "Progression", ja: "進捗", ko: "진행률", pt: "Progresso" },
  "Enter each carton's outside dimensions, gross weight and quantity.": {
    es: "Ingresa dimensiones exteriores, peso bruto y cantidad de cada caja.",
    de: "Außenmaße, Bruttogewicht und Menge je Karton eingeben.",
    fr: "Saisissez les dimensions extérieures, le poids brut et la quantité.",
    ja: "各カートンの外寸・総重量・注文箱数を入力してください。",
    ko: "각 박스의 외경 치수, 총중량 및 주문 수량을 입력하세요.",
    pt: "Insira as dimensões externas, peso bruto e quantidade de cada caixa.",
  },
  "This is a sample order. Edit the rows or import your own order with Excel or CSV.": {
    es: "Pedido de ejemplo. Edita las filas o importa tu pedido desde Excel o CSV.",
    de: "Beispielauftrag. Zeilen bearbeiten oder eigene Excel-/CSV-Datei importieren.",
    fr: "Commande exemple. Modifiez les lignes ou importez votre fichier Excel/CSV.",
    ja: "サンプル注文を表示中です。行を編集するか、Excel/CSVを取り込んでください。",
    ko: "샘플 주문입니다. 행을 편집하거나 Excel/CSV로 직접 주문서를 가져오세요.",
    pt: "Pedido de exemplo. Edite as linhas ou importe seu pedido em Excel ou CSV.",
  },
  // Beginner Quick-Start Strip, Live Capacity Gauge & Quick Calculate
  "Quick start": { es: "Inicio rápido", de: "Schnellstart", fr: "Démarrage rapide", ja: "クイックスタート", ko: "빠른 시작", pt: "Início rápido" },
  "40HQ Loose (Skip to Cargo)": {
    es: "40HQ Suelto (Ir a Carga)", de: "40HQ Lose (Direkt zu Fracht)", fr: "40HQ Vrac (Aller à Charge)",
    ja: "40HQ バラ積み（貨物入力へ）", ko: "40HQ 벌크 직적재 (화물 입력)", pt: "40HQ Solto (Ir para Carga)",
  },
  "20GP Loose (Skip to Cargo)": {
    es: "20GP Suelto (Ir a Carga)", de: "20GP Lose (Direkt zu Fracht)", fr: "20GP Vrac (Aller à Charge)",
    ja: "20GP バラ積み（貨物入力へ）", ko: "20GP 벌크 직적재 (화물 입력)", pt: "20GP Solto (Ir para Carga)",
  },
  "40HQ Palletized": {
    es: "40HQ Paletizado", de: "40HQ Palettiert", fr: "40HQ Palettisé",
    ja: "40HQ パレット積載", ko: "40HQ 팔레트 적재", pt: "40HQ Paletizado",
  },
  "1-Click Demo 3D Plan": {
    es: "Demo 3D en 1 clic", de: "1-Klick 3D-Demo", fr: "Démo 3D en 1 clic",
    ja: "ワンクリック3Dデモ", ko: "원클릭 3D 데모", pt: "Demo 3D em 1 clique",
  },
  "Quick calculate": {
    es: "Cálculo rápido", de: "Schnell berechnen", fr: "Calcul rapide",
    ja: "今すぐ計算", ko: "바로 계산", pt: "Cálculo rápido",
  },
  "Live capacity estimate": {
    es: "Capacidad estimada en vivo", de: "Live-Kapazitätsschätzung", fr: "Capacité estimée en direct",
    ja: "リアルタイム積載目安", ko: "실시간 적재량 예측", pt: "Estimativa de capacidade",
  },
  "Total cartons": { es: "Total cajas", de: "Kartons gesamt", fr: "Total cartons", ja: "合計箱数", ko: "총 박스 수", pt: "Total de caixas" },
  "Gross volume": { es: "Volumen total", de: "Gesamtvolumen", fr: "Volume total", ja: "合計容積", ko: "총 부피", pt: "Volume total" },
  "Fits 20GP well": { es: "Ideal para 20GP", de: "Passt gut in 20GP", fr: "Adapté au 20GP", ja: "20GP 推奨", ko: "20GP 적합", pt: "Ideal para 20GP" },
  "Fits 40HQ well": { es: "Ideal para 40HQ", de: "Passt gut in 40HQ", fr: "Adapté au 40HQ", ja: "40HQ 推奨", ko: "40HQ 적합", pt: "Ideal para 40HQ" },
  "May exceed single container": {
    es: "Puede exceder 1 contenedor", de: "Überschreitet ggf. 1 Container", fr: "Peut dépasser 1 conteneur",
    ja: "1本超過の可能性あり", ko: "단일 컨테이너 초과 예상", pt: "Pode exceder 1 contêiner",
  },
  // v1.1 Simple/Expert Mode, CoG/VGM, Shipping Marks & Landed Cost
  "Simple 3-Step": { es: "Simple 3 pasos", de: "Einfach 3 Schritte", fr: "Simple 3 étapes", ja: "かんたん3ステップ", ko: "간편 3단계", pt: "Simples 3 passos" },
  "Expert 7-Step": { es: "Experto 7 pasos", de: "Experte 7 Schritte", fr: "Expert 7 étapes", ja: "エキスパート7ステップ", ko: "전문가 7단계", pt: "Avançado 7 passos" },
  "CoG · VGM & Marks": { es: "CdG · VGM y Marcas", de: "Schwerpunkt · VGM", fr: "CdG · VGM & Marques", ja: "重心・VGM・ケースマーク", ko: "무게중심 · VGM · 쉬핑마크", pt: "CG · VGM e Marcas" },
  "Print / Export VGM Declaration": { es: "Imprimir / Exportar VGM", de: "VGM-Erklärung drucken", fr: "Imprimer / Exporter VGM", ja: "SOLAS VGM 申告書を印刷", ko: "SOLAS VGM 신고서 인쇄", pt: "Imprimir / Exportar VGM" },
  "Generate Batch Shipping Marks PDF": { es: "Generar Marcas de Envío PDF", de: "Versandmarken-PDF erstellen", fr: "Générer Marques d'Expédition PDF", ja: "ケースマークPDF一括作成", ko: "쉬핑마크 PDF 일괄 생성", pt: "Gerar Marcas de Envio PDF" },
};

export function translateLocaleFromEnglish(englishText: string, language: UiLanguage): string | undefined {
  if (language === "zh" || language === "en") return undefined;
  const entry = TRANSLATIONS[englishText];
  return entry ? entry[language] : undefined;
}
