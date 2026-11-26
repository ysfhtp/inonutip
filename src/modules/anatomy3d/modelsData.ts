export type AnatomyModelId = 'cell' | 'heart' | 'brain' | 'skull' | 'femur' | 'thorax';

export interface AnatomyPartInfo {
  id: string;
  latin: string;
  tr: string;
  en: string;
  systemTr: string;
  systemEn: string;
  examTipTr: string;
  examTipEn: string;
  explodeVec: [number, number, number];
  focusOffset: [number, number, number];
}

export interface AnatomyModelSpec {
  id: AnatomyModelId;
  latin: string;
  tr: string;
  en: string;
  shortTr: string;
  shortEn: string;
  committeeHintTr: string;
  committeeHintEn: string;
  cameraPos: [number, number, number];
  cameraTarget: [number, number, number];
  parts: AnatomyPartInfo[];
}

export interface LessonAnatomyMatch {
  modelId: AnatomyModelId;
  partId?: string;
  labelTr: string;
  labelEn: string;
}

export const ANATOMY_MODELS: AnatomyModelSpec[] = [
  {
    id: 'cell',
    latin: 'Cellula Eukaryotica',
    tr: 'Ökaryotik Hücre',
    en: 'Eukaryotic Cell',
    shortTr: 'Hücre',
    shortEn: 'Cell',
    committeeHintTr: 'Kurul II • Histoloji & Tıbbi Biyoloji',
    committeeHintEn: 'Committee II • Histology & Cell Biology',
    cameraPos: [0.3, 1.5, 4.9],
    cameraTarget: [0, 0.05, 0],
    parts: [
      {
        id: 'membrane',
        latin: 'Membrana plasmatica',
        tr: 'Plazma Membranı',
        en: 'Plasma Membrane',
        systemTr: 'Hücre Sınırı',
        systemEn: 'Cell Boundary',
        examTipTr: 'Akıcı mozaik model; fosfolipid çift tabakası + integral proteinler seçici geçirgenliği sağlar.',
        examTipEn: 'Fluid mosaic model; phospholipid bilayer and integral proteins control selective permeability.',
        explodeVec: [0, 0.25, -0.85],
        focusOffset: [0.4, 0.8, 3.8],
      },
      {
        id: 'nucleus',
        latin: 'Nucleus et Nucleolus',
        tr: 'Çekirdek ve Çekirdekçik',
        en: 'Nucleus & Nucleolus',
        systemTr: 'Genetik Merkez',
        systemEn: 'Genetic Control',
        examTipTr: 'Çift katlı nükleer zarf (porlar içerir); çekirdekçikte rRNA sentezi ve ribozom alt birim montajı yapılır.',
        examTipEn: 'Double nuclear envelope with pores; the nucleolus synthesizes rRNA and assembles ribosomal subunits.',
        explodeVec: [0, 0.85, 0],
        focusOffset: [0.2, 0.6, 2.8],
      },
      {
        id: 'mitochondrion',
        latin: 'Mitochondrion',
        tr: 'Mitokondri',
        en: 'Mitochondrion',
        systemTr: 'Enerji Metabolizması',
        systemEn: 'Energy Metabolism',
        examTipTr: 'İç zar kıvrımları (krista) üzerinde oksidatif fosforilasyon ile ATP üretilir; kendi dairesel mtDNA’sı vardır.',
        examTipEn: 'Inner membrane cristae drive oxidative phosphorylation for ATP synthesis; carries maternal circular mtDNA.',
        explodeVec: [1.05, -0.2, 0.55],
        focusOffset: [1.8, 0.4, 2.5],
      },
      {
        id: 'er',
        latin: 'Reticulum endoplasmaticum granulosum',
        tr: 'Granüllü Endoplazmik Retikulum (GER)',
        en: 'Rough Endoplasmic Reticulum',
        systemTr: 'Protein Sentezi',
        systemEn: 'Protein Synthesis',
        examTipTr: 'Üzerindeki ribozomlar salgı, membran ve lizozomal proteinleri sentezler; dış çekirdek zarıyla devam eder.',
        examTipEn: 'Surface ribosomes translate secretory, membrane, and lysosomal proteins; continuous with outer nuclear envelope.',
        explodeVec: [-0.95, 0.3, 0.5],
        focusOffset: [-1.7, 0.6, 2.6],
      },
      {
        id: 'golgi',
        latin: 'Apparatus Golgii',
        tr: 'Golgi Kompleksi',
        en: 'Golgi Apparatus',
        systemTr: 'Paketleme & Glikozilasyon',
        systemEn: 'Sorting & Glycosylation',
        examTipTr: 'Cis yüzü ER’den vezikül alır; trans yüzü glikozillenmiş ve paketlenmiş proteinleri hedefe gönderir.',
        examTipEn: 'Cis face receives vesicles from ER; trans face dispatches glycosylated and sorted proteins to targets.',
        explodeVec: [0.2, -0.95, 0.85],
        focusOffset: [0.3, -0.5, 2.9],
      },
      {
        id: 'lysosome',
        latin: 'Lysosoma',
        tr: 'Lizozom',
        en: 'Lysosome',
        systemTr: 'Hücre İçi Sindirim',
        systemEn: 'Intracellular Digestion',
        examTipTr: 'Asit hidrolaz enzimleri (pH ~4.8) taşır; mannoz-6-fosfat etiketi ile Golgi’den hedeflenir.',
        examTipEn: 'Houses acid hydrolases (pH ~4.8); enzymes are targeted from the Golgi via mannose-6-phosphate tags.',
        explodeVec: [-0.85, -0.75, 0.7],
        focusOffset: [-1.5, -0.4, 2.7],
      },
      {
        id: 'peroxisome',
        latin: 'Peroxisoma',
        tr: 'Peroksizom',
        en: 'Peroxisome',
        systemTr: 'Oksidatif Detoksifikasyon',
        systemEn: 'Oxidative Detoxification',
        examTipTr: 'Çok uzun zincirli yağ asitlerinin beta-oksidasyonu ve katalaz enzimiyle H₂O₂ yıkımını yapar.',
        examTipEn: 'Performs very-long-chain fatty acid beta-oxidation and degrades H₂O₂ using catalase.',
        explodeVec: [0.95, 0.65, 0.65],
        focusOffset: [1.6, 1.0, 2.5],
      },
      {
        id: 'centrosome',
        latin: 'Centrosoma (Centrioli)',
        tr: 'Sentrozom ve Sentrioller',
        en: 'Centrosome & Centrioles',
        systemTr: 'Hücre İskeleti / Mitoz',
        systemEn: 'Cytoskeleton / Mitosis',
        examTipTr: 'Birbirine dik iki sentriol (9×3 mikrotübül üçlüsü); mitozda iğ ipliklerini organize eden MTOC merkezidir.',
        examTipEn: 'Pair of orthogonal centrioles (9×3 microtubule triplets); principal MTOC organizing mitotic spindles.',
        explodeVec: [-0.35, 0.85, 0.95],
        focusOffset: [-0.6, 1.2, 2.7],
      },
    ],
  },
  {
    id: 'heart',
    latin: 'Cor',
    tr: 'Kalp',
    en: 'Heart',
    shortTr: 'Kalp',
    shortEn: 'Heart',
    committeeHintTr: 'Kardiyovasküler Anatomi',
    committeeHintEn: 'Cardiovascular Anatomy',
    cameraPos: [0.2, 0.6, 4.7],
    cameraTarget: [0, 0.05, 0],
    parts: [
      {
        id: 'left_ventricle',
        latin: 'Ventriculus sinister',
        tr: 'Sol Ventrikül',
        en: 'Left Ventricle',
        systemTr: 'Sistemik Pompa',
        systemEn: 'Systemic Pump',
        examTipTr: 'Miyokardı sağ ventrikülden ~3 kat kalındır; kalbin apeksini (apex cordis) oluşturur ve aortaya kan pompalar.',
        examTipEn: 'Myocardium is ~3× thicker than the right ventricle; forms the apex cordis and pumps blood into the aorta.',
        explodeVec: [0.75, -0.45, 0.35],
        focusOffset: [1.6, -0.2, 3.0],
      },
      {
        id: 'right_ventricle',
        latin: 'Ventriculus dexter',
        tr: 'Sağ Ventrikül',
        en: 'Right Ventricle',
        systemTr: 'Pulmoner Pompa',
        systemEn: 'Pulmonary Pump',
        examTipTr: 'Kalbin sternokostal (ön) yüzünün büyük bölümünü oluşturur; kanı truncus pulmonalis’e pompalar.',
        examTipEn: 'Forms most of the sternocostal (anterior) surface; ejects deoxygenated blood into the pulmonary trunk.',
        explodeVec: [-0.7, -0.35, 0.55],
        focusOffset: [-1.4, -0.2, 3.1],
      },
      {
        id: 'right_atrium',
        latin: 'Atrium dextrum',
        tr: 'Sağ Atriyum',
        en: 'Right Atrium',
        systemTr: 'Venöz Giriş',
        systemEn: 'Venous Inflow',
        examTipTr: 'Sinoatriyal (SA) düğüm sulcus terminalis üst ucunda yer alır; VCS, VCI ve sinus coronarius buraya açılır.',
        examTipEn: 'Contains the sinoatrial (SA) node near the SVC opening; receives SVC, IVC, and the coronary sinus.',
        explodeVec: [-0.95, 0.45, 0.2],
        focusOffset: [-1.9, 0.7, 2.8],
      },
      {
        id: 'left_atrium',
        latin: 'Atrium sinistrum',
        tr: 'Sol Atriyum',
        en: 'Left Atrium',
        systemTr: 'Pulmoner Venöz Giriş',
        systemEn: 'Pulmonary Venous Inflow',
        examTipTr: 'Kalbin tabanının (basis cordis) büyük kısmını oluşturur ve 4 adet vena pulmonalis buraya açılır.',
        examTipEn: 'Forms most of the base of the heart (basis cordis) and receives four valveless pulmonary veins.',
        explodeVec: [0.85, 0.55, -0.45],
        focusOffset: [1.7, 0.8, -2.6],
      },
      {
        id: 'aorta',
        latin: 'Arcus aortae',
        tr: 'Aort Arkı',
        en: 'Aortic Arch',
        systemTr: 'Büyük Arterler',
        systemEn: 'Great Vessels',
        examTipTr: '3 ana dalı sırasıyla: Truncus brachiocephalicus, A. carotis communis sinistra ve A. subclavia sinistra.',
        examTipEn: 'Three major branches in order: brachiocephalic trunk, left common carotid, and left subclavian artery.',
        explodeVec: [0.2, 1.05, -0.15],
        focusOffset: [0.4, 1.6, 3.0],
      },
      {
        id: 'pulmonary_trunk',
        latin: 'Truncus pulmonalis',
        tr: 'Pulmoner Trunkus',
        en: 'Pulmonary Trunk',
        systemTr: 'Pulmoner Dolaşım',
        systemEn: 'Pulmonary Circulation',
        examTipTr: 'Aort arkının altında sağ ve sol pulmoner arterlere ayrılır; ligamentum arteriosum ile aortaya bağlanır.',
        examTipEn: 'Bifurcates beneath the aortic arch into left/right pulmonary arteries; linked to aorta by ligamentum arteriosum.',
        explodeVec: [0.1, 0.65, 0.85],
        focusOffset: [0.3, 0.9, 3.2],
      },
      {
        id: 'vena_cava',
        latin: 'Vena cava superior et inferior',
        tr: 'Üst ve Alt Ana Toplardamar',
        en: 'Superior & Inferior Vena Cava',
        systemTr: 'Sistemik Venöz Dönüş',
        systemEn: 'Systemic Venous Return',
        examTipTr: 'VCS baş, boyun ve üst ekstremite kanını; VCI diyafram altındaki sistemik venöz kanı sağ atriyuma taşır.',
        examTipEn: 'SVC drains upper body venous blood; IVC returns sub-diaphragmatic blood directly into the right atrium.',
        explodeVec: [-1.05, 0.85, -0.25],
        focusOffset: [-2.1, 1.1, 2.7],
      },
      {
        id: 'coronary_lad',
        latin: 'Ramus interventricularis anterior (LAD)',
        tr: 'Ön İnterventriküler Koroner Arter',
        en: 'Left Anterior Descending Artery',
        systemTr: 'Koroner Dolaşım',
        systemEn: 'Coronary Circulation',
        examTipTr: 'Sol koroner arterin dalıdır; sulcus interventricularis anterior’da seyreder ve MI’da en sık tıkanan damardır.',
        examTipEn: 'Branch of LCA running in the anterior interventricular sulcus; most frequently occluded vessel in myocardial infarction.',
        explodeVec: [0.05, -0.15, 0.95],
        focusOffset: [0.2, 0.0, 3.2],
      },
    ],
  },
  {
    id: 'brain',
    latin: 'Encephalon',
    tr: 'Beyin',
    en: 'Brain',
    shortTr: 'Beyin',
    shortEn: 'Brain',
    committeeHintTr: 'Nöroanatomi & Sinir Sistemi',
    committeeHintEn: 'Neuroanatomy & Nervous System',
    cameraPos: [3.2, 1.2, 3.4],
    cameraTarget: [0, 0.05, 0],
    parts: [
      {
        id: 'frontal',
        latin: 'Lobus frontalis',
        tr: 'Frontal Lob',
        en: 'Frontal Lobe',
        systemTr: 'Telencephalon',
        systemEn: 'Telencephalon',
        examTipTr: 'Sulcus centralis (Rolando) önünde yer alır; primer motor korteks (Brodmann 4) ve Broca alanı (44–45) buradadır.',
        examTipEn: 'Anterior to central sulcus (Rolando); contains primary motor cortex (BA 4) and Broca’s speech area (BA 44–45).',
        explodeVec: [0, 0.35, 0.95],
        focusOffset: [1.8, 0.9, 3.2],
      },
      {
        id: 'parietal',
        latin: 'Lobus parietalis',
        tr: 'Parietal Lob',
        en: 'Parietal Lobe',
        systemTr: 'Telencephalon',
        systemEn: 'Telencephalon',
        examTipTr: 'Gyrus postcentralis’te primer somatosensoriyel korteks (Brodmann 3,1,2) bulunur; dokunma ve propriosepsiyonu işler.',
        examTipEn: 'Postcentral gyrus hosts primary somatosensory cortex (BA 3,1,2) for tactile sensation and proprioception.',
        explodeVec: [0, 0.85, -0.15],
        focusOffset: [2.2, 1.5, 1.2],
      },
      {
        id: 'occipital',
        latin: 'Lobus occipitalis',
        tr: 'Oksipital Lob',
        en: 'Occipital Lobe',
        systemTr: 'Telencephalon',
        systemEn: 'Telencephalon',
        examTipTr: 'Sulcus calcarinus çevresinde primer görme korteksi (Brodmann 17) bulunur; A. cerebri posterior ile beslenir.',
        examTipEn: 'Primary visual cortex (BA 17) surrounds the calcarine sulcus; supplied by the posterior cerebral artery.',
        explodeVec: [0, 0.25, -1.0],
        focusOffset: [1.8, 0.6, -3.1],
      },
      {
        id: 'temporal',
        latin: 'Lobus temporalis',
        tr: 'Temporal Lob',
        en: 'Temporal Lobe',
        systemTr: 'Telencephalon',
        systemEn: 'Telencephalon',
        examTipTr: 'Sulcus lateralis (Sylvius) altındadır; primer işitme korteksi (Heschl, BA 41–42) ve Wernicke alanı (BA 22) buradadır.',
        examTipEn: 'Inferior to lateral sulcus (Sylvius); houses primary auditory cortex (BA 41–42) and Wernicke’s area (BA 22).',
        explodeVec: [0.95, -0.25, 0.1],
        focusOffset: [3.2, 0.0, 1.2],
      },
      {
        id: 'cerebellum',
        latin: 'Cerebellum',
        tr: 'Beyincik (Serebellum)',
        en: 'Cerebellum',
        systemTr: 'Rhombencephalon',
        systemEn: 'Rhombencephalon',
        examTipTr: 'Fossa cranii posterior’da bulunur; denge, postür ve motor koordinasyonu ipsilateral olarak düzenler.',
        examTipEn: 'Lies in the posterior cranial fossa; coordinates posture, balance, and fine motor control ipsilaterally.',
        explodeVec: [0, -0.75, -0.95],
        focusOffset: [1.6, -0.8, -2.8],
      },
      {
        id: 'pons',
        latin: 'Pons',
        tr: 'Pons (Köprü)',
        en: 'Pons',
        systemTr: 'Truncus Encephali',
        systemEn: 'Brainstem',
        examTipTr: 'Kraniyal sinir V, VI, VII ve VIII çekirdeklerini içerir; orta serebellar pedinkül ile serebelluma bağlanır.',
        examTipEn: 'Houses nuclei for CN V–VIII and bridges cerebral hemispheres to cerebellum via middle cerebellar peduncles.',
        explodeVec: [0, -0.65, 0.4],
        focusOffset: [1.6, -0.9, 2.4],
      },
      {
        id: 'medulla',
        latin: 'Medulla oblongata (Bulbus)',
        tr: 'Omurilik Soğanı (Bulbus)',
        en: 'Medulla Oblongata',
        systemTr: 'Truncus Encephali',
        systemEn: 'Brainstem',
        examTipTr: 'Solunum ve dolaşım merkezleri ile decussatio pyramidum buradadır; CN IX, X, XI ve XII çıkar.',
        examTipEn: 'Contains vital cardiorespiratory centers and pyramidal decussation; origin of cranial nerves IX–XII.',
        explodeVec: [0, -1.1, 0.1],
        focusOffset: [1.5, -1.3, 2.2],
      },
      {
        id: 'corpus_callosum',
        latin: 'Corpus callosum',
        tr: 'Korpus Kallozum',
        en: 'Corpus Callosum',
        systemTr: 'Komissural Yollar',
        systemEn: 'Commissural Fibers',
        examTipTr: 'İki serebral hemisferi birbirine bağlayan en büyük beyaz cevher komissürüdür (rostrum, genu, truncus, splenium).',
        examTipEn: 'Largest white-matter commissure linking left and right hemispheres (rostrum, genu, body, splenium).',
        explodeVec: [0, 0.45, 0],
        focusOffset: [2.3, 0.6, 1.8],
      },
    ],
  },
  {
    id: 'skull',
    latin: 'Cranium',
    tr: 'Kafatası',
    en: 'Skull',
    shortTr: 'Kafatası',
    shortEn: 'Skull',
    committeeHintTr: 'Baş & Boyun Osteolojisi',
    committeeHintEn: 'Head & Neck Osteology',
    cameraPos: [1.9, 0.7, 4.3],
    cameraTarget: [0, 0.0, 0],
    parts: [
      {
        id: 'frontal_bone',
        latin: 'Os frontale',
        tr: 'Alın Kemiği (Frontal)',
        en: 'Frontal Bone',
        systemTr: 'Neurocranium',
        systemEn: 'Neurocranium',
        examTipTr: 'Sutura coronalis ile parietal kemiklere bağlanır; içinde sinus frontalis ve glabella yer alır.',
        examTipEn: 'Joins parietal bones at the coronal suture; encloses the frontal sinus and forms the orbital roof.',
        explodeVec: [0, 0.55, 0.8],
        focusOffset: [1.2, 1.0, 3.4],
      },
      {
        id: 'parietal_bone',
        latin: 'Os parietale',
        tr: 'Duvar Kemiği (Parietal)',
        en: 'Parietal Bone',
        systemTr: 'Neurocranium',
        systemEn: 'Neurocranium',
        examTipTr: 'Çift kemiktir; ortada sutura sagittalis, arkada sutura lambdoidea ile birleşir. Pterion bölgesi A. meningea media için kritiktir.',
        examTipEn: 'Paired vault bones meeting at sagittal suture; pterion overlies the middle meningeal artery (epidural hematoma risk).',
        explodeVec: [0, 0.9, -0.15],
        focusOffset: [2.2, 1.5, 2.2],
      },
      {
        id: 'occipital_bone',
        latin: 'Os occipitale',
        tr: 'Art Kafa Kemiği (Oksipital)',
        en: 'Occipital Bone',
        systemTr: 'Neurocranium',
        systemEn: 'Neurocranium',
        examTipTr: 'Foramen magnum ve condylus occipitalis (atlas ile eklem) bu kemiktedir; protuberantia occipitalis externa önemli palpasyon noktasıdır.',
        examTipEn: 'Contains foramen magnum and occipital condyles articulating with C1 (atlas); external occipital protuberance is a key landmark.',
        explodeVec: [0, 0.15, -0.95],
        focusOffset: [1.5, 0.4, -3.5],
      },
      {
        id: 'temporal_bone',
        latin: 'Os temporale',
        tr: 'Şakak Kemiği (Temporal)',
        en: 'Temporal Bone',
        systemTr: 'Neurocranium',
        systemEn: 'Neurocranium',
        examTipTr: 'Pars petrosa işitme/denge organlarını korur; processus mastoideus, meatus acusticus externus ve canalis facialis buradadır.',
        examTipEn: 'Petrous part houses inner ear; features mastoid process, external acoustic meatus, and facial nerve canal.',
        explodeVec: [0.95, -0.05, -0.15],
        focusOffset: [3.3, 0.2, 1.3],
      },
      {
        id: 'sphenoid_bone',
        latin: 'Os sphenoidale',
        tr: 'Sfenoid (Temel) Kemik',
        en: 'Sphenoid Bone',
        systemTr: 'Basis Cranii',
        systemEn: 'Cranial Base',
        examTipTr: 'Sella turcica hipofiz bezini barındırır; foramen rotundum (V2), ovale (V3) ve spinosum (A. meningea media) burada bulunur.',
        examTipEn: 'Sella turcica cradles the pituitary gland; transmits CN V2 (rotundum), CN V3 (ovale), and middle meningeal artery (spinosum).',
        explodeVec: [0.75, 0.05, 0.45],
        focusOffset: [2.8, 0.3, 2.2],
      },
      {
        id: 'zygomatic_bone',
        latin: 'Os zygomaticum',
        tr: 'Elmacık Kemiği (Zigomatik)',
        en: 'Zygomatic Bone',
        systemTr: 'Viscerocranium',
        systemEn: 'Viscerocranium',
        examTipTr: 'Orbita dış duvarını oluşturur ve temporal kemikle birleşerek arcus zygomaticus’u (M. masseter tutunma yeri) yapar.',
        examTipEn: 'Forms lateral orbital rim and joins temporal process to create the zygomatic arch (masseter origin).',
        explodeVec: [0.85, -0.15, 0.7],
        focusOffset: [2.4, 0.1, 3.0],
      },
      {
        id: 'maxilla',
        latin: 'Maxilla',
        tr: 'Üst Çene Kemiği (Maksilla)',
        en: 'Maxilla',
        systemTr: 'Viscerocranium',
        systemEn: 'Viscerocranium',
        examTipTr: 'Üst diş alveollerini taşır; en büyük paranazal sinüs olan sinus maxillaris içindedir. Foramen infraorbitale buradadır.',
        examTipEn: 'Bears upper teeth, encloses the largest paranasal sinus (maxillary), and features the infraorbital foramen.',
        explodeVec: [0, -0.25, 0.95],
        focusOffset: [0.9, -0.1, 3.6],
      },
      {
        id: 'mandible',
        latin: 'Mandibula',
        tr: 'Alt Çene Kemiği (Mandibula)',
        en: 'Mandible',
        systemTr: 'Viscerocranium',
        systemEn: 'Viscerocranium',
        examTipTr: 'Kafatasının tek hareketli kemiğidir; caput mandibulae temporal kemikle TMJ (temporomandibular eklem) yapar.',
        examTipEn: 'Only mobile skull bone; mandibular condyle articulates with temporal bone to form the TMJ.',
        explodeVec: [0, -0.9, 0.65],
        focusOffset: [1.2, -0.9, 3.4],
      },
    ],
  },
  {
    id: 'femur',
    latin: 'Os Femoris',
    tr: 'Femur & Diz Eklemi',
    en: 'Femur & Knee',
    shortTr: 'Femur',
    shortEn: 'Femur',
    committeeHintTr: 'Lokomotor Sistem Osteolojisi',
    committeeHintEn: 'Locomotor Osteology',
    cameraPos: [0.6, 0.35, 5.2],
    cameraTarget: [0, 0.0, 0],
    parts: [
      {
        id: 'caput_femoris',
        latin: 'Caput femoris',
        tr: 'Femur Başı',
        en: 'Femoral Head',
        systemTr: 'Proksimal Epifiz',
        systemEn: 'Proximal Epiphysis',
        examTipTr: 'Acetabulum ile sferoid (top-yuva) kalça eklemi yapar; fovea capitis femoris’e lig. capitis femoris tutunur.',
        examTipEn: 'Forms ball-and-socket hip joint with acetabulum; fovea capitis attaches ligamentum teres (foveolar artery).',
        explodeVec: [-0.85, 0.85, 0.15],
        focusOffset: [-1.4, 1.8, 3.1],
      },
      {
        id: 'collum_femoris',
        latin: 'Collum femoris',
        tr: 'Femur Boynu',
        en: 'Femoral Neck',
        systemTr: 'Proksimal Femur',
        systemEn: 'Proximal Femur',
        examTipTr: 'İnklinasyon açısı normalde ~125°’dir; kırıklarında A. circumflexa femoris medialis yaralanıp avasküler nekroza yol açabilir.',
        examTipEn: 'Normal neck-shaft angle ~125°; intracapsular fractures risk damaging medial circumflex femoral artery (AVN).',
        explodeVec: [-0.5, 0.65, 0.2],
        focusOffset: [-1.0, 1.5, 3.1],
      },
      {
        id: 'trochanter_major',
        latin: 'Trochanter major',
        tr: 'Büyük Trokanter',
        en: 'Greater Trochanter',
        systemTr: 'Kas Tutunma Çıkıntısı',
        systemEn: 'Muscle Attachment',
        examTipTr: 'M. gluteus medius ve minimus (kalça abdüktörleri) buraya tutunur; lateralde kolayca palpe edilir.',
        examTipEn: 'Insertion site for hip abductors (gluteus medius & minimus) and deep external rotators; easily palpable laterally.',
        explodeVec: [0.85, 0.75, 0.1],
        focusOffset: [1.5, 1.6, 3.0],
      },
      {
        id: 'trochanter_minor',
        latin: 'Trochanter minor',
        tr: 'Küçük Trokanter',
        en: 'Lesser Trochanter',
        systemTr: 'Kas Tutunma Çıkıntısı',
        systemEn: 'Muscle Attachment',
        examTipTr: 'Posteromedialde yer alır; kalçanın en güçlü fleksörü olan M. iliopsoas buraya tutunur.',
        examTipEn: 'Located posteromedially; primary insertion point for iliopsoas (the strongest hip flexor).',
        explodeVec: [-0.55, 0.35, -0.65],
        focusOffset: [-1.1, 1.0, -2.9],
      },
      {
        id: 'corpus_femoris',
        latin: 'Corpus femoris (Diaphysis)',
        tr: 'Femur Gövdesi',
        en: 'Femoral Shaft',
        systemTr: 'Diyafiz',
        systemEn: 'Diaphysis',
        examTipTr: 'Arka yüzündeki keskin kenara linea aspera denir; uyluk addüktör kasları ve vastus kasları buraya tutunur.',
        examTipEn: 'Posterior ridge is the linea aspera, anchoring thigh adductors and vastus muscles; strongest human long bone.',
        explodeVec: [0, 0, 0],
        focusOffset: [0.5, 0.1, 3.8],
      },
      {
        id: 'condyles',
        latin: 'Condylus medialis et lateralis',
        tr: 'Medial ve Lateral Kondiller',
        en: 'Medial & Lateral Condyles',
        systemTr: 'Distal Epifiz',
        systemEn: 'Distal Epiphysis',
        examTipTr: 'Tibia ile diz eklemini yapar; aralarındaki fossa intercondylaris’e ön ve arka çapraz bağlar (ACL/PCL) tutunur.',
        examTipEn: 'Articulate with tibial plateau; intercondylar fossa between them anchors the anterior and posterior cruciate ligaments.',
        explodeVec: [0, -0.75, 0.1],
        focusOffset: [0.5, -1.6, 3.1],
      },
      {
        id: 'patella',
        latin: 'Patella',
        tr: 'Diz Kapağı (Patella)',
        en: 'Patella (Kneecap)',
        systemTr: 'Sesamoid Kemik',
        systemEn: 'Sesamoid Bone',
        examTipTr: 'Vücuttaki en büyük sesamoid kemiktir; M. quadriceps femoris tendonunun kaldıraç kolunu artırır.',
        examTipEn: 'Largest sesamoid bone in the body; embedded in the quadriceps tendon to boost knee extension leverage.',
        explodeVec: [0, -0.75, 0.95],
        focusOffset: [0.8, -1.5, 3.4],
      },
    ],
  },
  {
    id: 'thorax',
    latin: 'Thorax et Columna Vertebralis',
    tr: 'Göğüs Kafesi & Omurga',
    en: 'Ribcage & Spine',
    shortTr: 'Toraks',
    shortEn: 'Thorax',
    cameraPos: [1.4, 0.6, 5.1],
    cameraTarget: [0, 0.05, 0],
    committeeHintTr: 'Toraks & Omurga Anatomisi',
    committeeHintEn: 'Thorax & Spine Anatomy',
    parts: [
      {
        id: 'manubrium',
        latin: 'Manubrium sterni',
        tr: 'Sternum Manubriyumu',
        en: 'Manubrium of Sternum',
        systemTr: 'Sternum',
        systemEn: 'Sternum',
        examTipTr: 'Corpus sterni ile birleştiği açıya Angulus sterni (Louis açısı, T4–T5 düzeyi) denir; 2. kaburga buraya tutunur.',
        examTipEn: 'Meets sternal body at the sternal angle (Angle of Louis, T4–T5 level), landmark for the 2nd costal cartilage.',
        explodeVec: [0, 0.85, 0.85],
        focusOffset: [0.5, 1.3, 3.4],
      },
      {
        id: 'corpus_sterni',
        latin: 'Corpus sterni',
        tr: 'Sternum Gövdesi',
        en: 'Body of Sternum',
        systemTr: 'Sternum',
        systemEn: 'Sternum',
        examTipTr: '2.–7. kıkırdak kaburgalar buraya eklem yapar; T5–T9 omurları hizasında kalbin ön duvarını korur.',
        examTipEn: 'Articulates with costal cartilages 2–7; shields the anterior surface of the heart across T5–T9 levels.',
        explodeVec: [0, 0.15, 0.95],
        focusOffset: [0.4, 0.3, 3.5],
      },
      {
        id: 'xiphoid',
        latin: 'Processus xiphoideus',
        tr: 'Ksifoid Çıkıntı',
        en: 'Xiphoid Process',
        systemTr: 'Sternum',
        systemEn: 'Sternum',
        examTipTr: 'T9–T10 düzeyindedir; diyaframın ön lifleri ve linea alba buraya tutunur. CPR sırasında baskı yapılmaz.',
        examTipEn: 'Lies at T9–T10 level; anchors anterior diaphragm fibers and linea alba—avoid direct pressure during CPR.',
        explodeVec: [0, -0.65, 0.9],
        focusOffset: [0.4, -0.7, 3.2],
      },
      {
        id: 'true_ribs',
        latin: 'Costae verae (I–VII)',
        tr: 'Gerçek Kaburgalar (1–7)',
        en: 'True Ribs (1–7)',
        systemTr: 'Cavea Thoracis',
        systemEn: 'Thoracic Cage',
        examTipTr: 'Kendi kostal kıkırdaklarıyla doğrudan sternuma bağlanır; alt kenarlarındaki sulcus costae’de VAN (Ven-Arter-Sinir) seyreder.',
        examTipEn: 'Attach directly to sternum via individual costal cartilages; subcostal groove houses neurovascular bundle (VAN).',
        explodeVec: [0.7, 0.35, 0.25],
        focusOffset: [2.2, 0.7, 3.2],
      },
      {
        id: 'false_ribs',
        latin: 'Costae spuriae (VIII–X)',
        tr: 'Yalancı Kaburgalar (8–10)',
        en: 'False Ribs (8–10)',
        systemTr: 'Cavea Thoracis',
        systemEn: 'Thoracic Cage',
        examTipTr: 'Sternuma doğrudan değil, 7. kaburganın kıkırdağı üzerinden bağlanarak arcus costalis’i oluşturur.',
        examTipEn: 'Connect indirectly to sternum via the 7th costal cartilage, forming the palpable costal margin (arcus costalis).',
        explodeVec: [0.75, -0.55, 0.2],
        focusOffset: [2.2, -0.7, 3.2],
      },
      {
        id: 'costal_cartilage',
        latin: 'Cartilago costalis',
        tr: 'Kostal Kıkırdaklar',
        en: 'Costal Cartilages',
        systemTr: 'Hiyalin Kıkırdak',
        systemEn: 'Hyaline Cartilage',
        examTipTr: 'Hiyalin kıkırdak yapısındadır; göğüs kafesine solunum sırasında elastikiyet ve genişleme yeteneği kazandırır.',
        examTipEn: 'Hyaline cartilage bars providing thoracic cage elasticity for inspiratory rib elevation and expansion.',
        explodeVec: [0.35, 0.05, 0.85],
        focusOffset: [1.1, 0.2, 3.4],
      },
      {
        id: 'thoracic_spine',
        latin: 'Vertebrae thoracicae (T1–T12)',
        tr: 'Torakal Omurlar ve Diskler',
        en: 'Thoracic Vertebrae & Discs',
        systemTr: 'Columna Vertebralis',
        systemEn: 'Vertebral Column',
        examTipTr: 'Kalp biçimli gövdeleri, uzun aşağı eğimli spinöz çıkıntıları ve kaburgalar için fovea costalis eklem yüzleri tipiktir.',
        examTipEn: 'Identified by heart-shaped bodies, downward-sloping spinous processes, and costal facets for rib articulation.',
        explodeVec: [0, 0, -0.95],
        focusOffset: [1.8, 0.3, -3.5],
      },
    ],
  },
];

export function getAnatomyModel(id: AnatomyModelId): AnatomyModelSpec {
  return ANATOMY_MODELS.find((m) => m.id === id) || ANATOMY_MODELS[0];
}

/**
 * Matches a schedule slot (lesson title + course code) to an interactive 3D anatomy/cell model.
 * Returns null for non-anatomy/non-biomedical slots (e.g., History, Language, Self study, Exams).
 */
export function matchLessonToAnatomy(slot: { title?: string; code?: string }): LessonAnatomyMatch | null {
  const titleRaw = String(slot.title || '').trim();
  const codeRaw = String(slot.code || '').trim().toUpperCase();
  if (!titleRaw) return null;

  const text = `${codeRaw} ${titleRaw}`.toLocaleLowerCase('tr-TR');

  // Skip exams, self study, generic humanities, ethics, safety
  if (
    /^(exam|sınav|sinav|tatil|uyum|orientation|self study|serbest çalışma|serbest calisma|seçmeli|elective)/i.test(titleRaw) ||
    codeRaw === 'EXAM' ||
    codeRaw === 'SINAV' ||
    codeRaw === 'TATİL' ||
    codeRaw === 'AİİT101' ||
    codeRaw === 'AİİT102' ||
    codeRaw === 'APHR101' ||
    codeRaw === 'APHR102' ||
    codeRaw === 'TD101' ||
    codeRaw === 'TD102' ||
    codeRaw === 'TL101' ||
    codeRaw === 'TL102' ||
    codeRaw === 'İNG101' ||
    codeRaw === 'İNG102'
  ) {
    return null;
  }

  // Heart / Cardiovascular
  if (/(kalp|kardiy|heart|cardiac|coronar|koroner|aort|ventrik|atriy|dolaşım|circulat)/.test(text)) {
    return { modelId: 'heart', labelTr: '3D Kalp', labelEn: '3D Heart' };
  }

  // Brain / Neuro / Excitable cells & Action potential
  if (/(beyin|nöro|neuro|brain|encephal|sereb|cereb|korteks|cortex|uyarılabilir|excitable|aksiyon potansiyel|action potential|sinir sistemi|nervous)/.test(text)) {
    return { modelId: 'brain', labelTr: '3D Beyin', labelEn: '3D Brain' };
  }

  // Skull / Head & Neck
  if (/(kafatası|kafatasi|crani|skull|mandibul|maxilla|sfenoid|sphenoid|frontal kemik|baş.*boyun|head.*neck)/.test(text)) {
    return { modelId: 'skull', labelTr: '3D Kafatası', labelEn: '3D Skull' };
  }

  // Thorax / Spine / Ribs
  if (/(toraks|thorax|göğüs kafes|gogus kafes|kaburga|costa|sternum|omurga|verteb|columna|ribcage|spine)/.test(text)) {
    return { modelId: 'thorax', labelTr: '3D Toraks', labelEn: '3D Thorax' };
  }

  // Femur / Osteology / Bones / Joints / Locomotor
  if (/(femur|kemik|osteo|eklem|arthro|lokomotor|locomotor|iskelet|skelet|ekstremite|extremit|patella|trochanter)/.test(text)) {
    return { modelId: 'femur', labelTr: '3D Femur', labelEn: '3D Femur' };
  }

  // Cell Biology / Histology organelles (matches active Committee II HE102, TBG102, MBG102, FİZ102, PHY102!)
  if (/(mitokondri|mitochondri)/.test(text)) {
    return { modelId: 'cell', partId: 'mitochondrion', labelTr: '3D Hücre', labelEn: '3D Cell' };
  }
  if (/(golgi)/.test(text)) {
    return { modelId: 'cell', partId: 'golgi', labelTr: '3D Hücre', labelEn: '3D Cell' };
  }
  if (/(endoplazmik|endoplasmic|ribozom|ribosom)/.test(text)) {
    return { modelId: 'cell', partId: 'er', labelTr: '3D Hücre', labelEn: '3D Cell' };
  }
  if (/(lizozom|lysosom)/.test(text)) {
    return { modelId: 'cell', partId: 'lysosome', labelTr: '3D Hücre', labelEn: '3D Cell' };
  }
  if (/(peroksizom|peroxisom)/.test(text)) {
    return { modelId: 'cell', partId: 'peroxisome', labelTr: '3D Hücre', labelEn: '3D Cell' };
  }
  if (/(nukleus|nükleus|nucleus|çekirdek|cekirdek|mitoz|mitosis|mayoz|meiosis|hücre döngü|cell cycle)/.test(text)) {
    return { modelId: 'cell', partId: 'nucleus', labelTr: '3D Hücre', labelEn: '3D Cell' };
  }
  if (/(membran|membrane|hücre hacmi|cell volume|taşınma|transport|hücrelerarası|cellular comm)/.test(text)) {
    return { modelId: 'cell', partId: 'membrane', labelTr: '3D Hücre', labelEn: '3D Cell' };
  }
  if (/(ipliksi organel|filamentous|sentrozom|centrosom)/.test(text)) {
    return { modelId: 'cell', partId: 'centrosome', labelTr: '3D Hücre', labelEn: '3D Cell' };
  }
  if (/(hücre|hucre|organel|cell|epitel|epitheli|bağ doku|bag doku|connective tissue)/.test(text)) {
    return { modelId: 'cell', labelTr: '3D Hücre', labelEn: '3D Cell' };
  }

  // Any generic Anatomy course code (AN101, AN102, AN103, ANAT...)
  if (/^AN\d/.test(codeRaw) || /(anatomi|anatomy)/.test(text)) {
    return { modelId: 'heart', labelTr: '3D Anatomi', labelEn: '3D Anatomy' };
  }

  return null;
}
