import type { ActionPlanDocument } from '@/types/action-plan-document'

const NOW = '2026-06-18T00:00:00.000Z'

export function makeSampleActionPlan(lang: 'en' | 'ar' = 'ar'): ActionPlanDocument {
  if (lang === 'en') {
    return {
      id: 'sample-action-plan-en',
      meta: {
        title:           'Executive Plan Evaluation Report',
        subtitle:        'Academic Year 2021–2022',
        orgName:         'Nile University · Faculty of Information Technology & Computer Science',
        orgLogoUrl:      null,
        partnerLogoUrls: [],
      },
      sections: [
        {
          id:         'sec-en-1',
          goalNumber: 1,
          goalTitle:  'Preparing Distinguished Graduates to Compete Locally and Internationally',
          objectives: [
            {
              id:        'obj-en-1-1',
              objective: 'Objective 1:\nAttracting Outstanding Students',
              rows: [
                {
                  id:         'r-en-1',
                  activities: 'Introducing the college to prospective students',
                  indicators: 'Intensity of awareness campaigns on social media during application periods',
                  completed:  'Intensive media campaigns conducted via the college page and sponsored ads on the official university page',
                  inProgress: '',
                  reasons:    '',
                  date:       'Aug & Sep',
                },
                {
                  id:         'r-en-2',
                  activities: 'Providing scholarships for top students to attract and motivate enrollment',
                  indicators: 'Number of students receiving scholarships and financial aid',
                  completed:  '462',
                  inProgress: '',
                  reasons:    '',
                  date:       'Academic Year',
                },
              ],
            },
            {
              id:        'obj-en-1-2',
              objective: 'Objective 2:\nContinuous Development of Programs to Keep Pace with Global Progress',
              rows: [
                {
                  id:         'r-en-3',
                  activities: 'Updating program regulations to meet industry needs and technological developments',
                  indicators: 'Identifying required updates for each program and implementing them',
                  completed:  'AI, BMD',
                  inProgress: '',
                  reasons:    '',
                  date:       'Sep',
                },
                {
                  id:         'r-en-4',
                  activities: 'Conducting internal and external program and curriculum reviews',
                  indicators: 'Preparing annual program reports to identify strengths, weaknesses, and improvement plans',
                  completed:  'CS, BMD Master',
                  inProgress: '',
                  reasons:    '',
                  date:       'Nov',
                },
              ],
            },
          ],
        },
        {
          id:         'sec-en-2',
          goalNumber: 2,
          goalTitle:  'Distinguished Academic and Support Staff in Research and Quality',
          objectives: [
            {
              id:        'obj-en-2-1',
              objective: 'Objective 1:\nCreating a Flexible and Motivating Work Environment for Education and Research',
              rows: [
                {
                  id:         'r-en-5',
                  activities: 'Establishing and updating specialized labs in the faculty',
                  indicators: 'Number of specialized labs established',
                  completed:  'VR Lab',
                  inProgress: 'All labs',
                  reasons:    '',
                  date:       'First Semester',
                },
                {
                  id:         'r-en-6',
                  activities: 'Updating library resources according to faculty educational and research needs',
                  indicators: 'Diversity of services provided by the library',
                  completed:  'See attachment',
                  inProgress: 'Responding to requirements as they arise',
                  reasons:    '',
                  date:       'Year-round',
                },
              ],
            },
            {
              id:        'obj-en-2-2',
              objective: 'Objective 2:\nApplying a Clear System for Assignment, Evaluation, and Defining Responsibilities',
              rows: [
                {
                  id:         'r-en-7',
                  activities: 'Establishing measurable criteria that ensure transparency in role and responsibility distribution',
                  indicators: 'Preparing and announcing job descriptions',
                  completed:  'Faculty Manual',
                  inProgress: '',
                  reasons:    '',
                  date:       'Year-round',
                },
              ],
            },
          ],
        },
      ],
      language:  'en',
      dir:       'ltr',
      createdAt: NOW,
      updatedAt: NOW,
    }
  }

  // Arabic (default)
  return {
    id: 'sample-action-plan-ar',
    meta: {
      title:           'تقييم الخطة التنفيذية',
      subtitle:        'لعام 2022-2021',
      orgName:         'جامعة النيل · كلية تكنولوجيا المعلومات وعلوم الحاسب',
      orgLogoUrl:      null,
      partnerLogoUrls: [],
    },
    sections: [
      {
        id:         'sec-1',
        goalNumber: 1,
        goalTitle:  'إعداد خريجين متميزين للمنافسة محلياً ودولياً',
        objectives: [
          {
            id:        'obj-1-1',
            objective: 'الهدف الأول:\nجذب الطالب المتميزين',
            rows: [
              {
                id:         'r-1',
                activities: 'تعريف الطالب بالكلية',
                indicators: 'كثافة حملات الدعاية على وسائل التواصل الاجتماعي في أوقات التقديم',
                completed:  'تم عمل حملات إعلامية مكثفة عبر صفحة الكلية وإعلانات ممولة عبر صفحة الجامعة الرسمية',
                inProgress: '',
                reasons:    '',
                date:       'شهر 8 و9',
              },
              {
                id:         'r-2',
                activities: 'توفير المنح الدراسية للطالب الأكفاء لجذبهم وتحفيزهم على الالتحاق بالكلية',
                indicators: 'عدد الطالب الحاصلين على المنح ومساعدات مالية',
                completed:  '462',
                inProgress: '',
                reasons:    '',
                date:       'العام الدراسي',
              },
            ],
          },
          {
            id:        'obj-1-2',
            objective: 'الهدف الثاني:\nالتطوير الدائم للبرامج لتواكب التطور العالمي',
            rows: [
              {
                id:         'r-3',
                activities: 'تحديث لوائح البرامج لتلبية احتياجات الصناعة والتطورات التكنولوجية',
                indicators: 'تحديد التحديث المطلوب لكل لائحة وتطبيقه',
                completed:  'AI BMD',
                inProgress: '',
                reasons:    '',
                date:       'شهر 9',
              },
              {
                id:         'r-4',
                activities: 'عمل المراجعة الداخلية والخارجية للبرامج والمقررات',
                indicators: 'إعداد التقارير السنوية للبرامج والمقررات لتحديد نقاط القوة والضعف ووضع خطة التحسين',
                completed:  'CS, BMD Master',
                inProgress: '',
                reasons:    '',
                date:       'شهر 11',
              },
            ],
          },
        ],
      },
      {
        id:         'sec-2',
        goalNumber: 2,
        goalTitle:  'عضو هيئة تدريس وهيئة معاونة متميز علمياً وبحثياً وفي مجال الجودة',
        objectives: [
          {
            id:        'obj-2-1',
            objective: 'الهدف الأول:\nخلق بيئة عمل مرنة ومحفزة على التعليم والبحث العلمي',
            rows: [
              {
                id:         'r-5',
                activities: 'إنشاء وتحديث المعامل المتخصصة بالكلية',
                indicators: 'المعامل المتخصصة المنشأة',
                completed:  'VR',
                inProgress: 'كل المعامل',
                reasons:    '',
                date:       'الفصل الدراسي الأول',
              },
              {
                id:         'r-6',
                activities: 'تحديث محتويات المكتبة وفقاً لمتطلبات الكلية التعليمية والبحثية',
                indicators: 'تنوع الخدمات التي تقدمها المكتبة',
                completed:  'مرفق',
                inProgress: 'يتم الاستجابة حسب المتطلبات',
                reasons:    '',
                date:       'طوال العام',
              },
            ],
          },
          {
            id:        'obj-2-2',
            objective: 'الهدف الثاني:\nتطبيق نظام واضح للتعيين والتقييم وتحديد المسئوليات',
            rows: [
              {
                id:         'r-7',
                activities: 'وضع معايير محددة قابلة للقياس تضمن الشفافية في توزيع الأدوار والاختصاصات',
                indicators: 'وضع وإعلان توصيف وظيفي',
                completed:  'Faculty manual',
                inProgress: '',
                reasons:    '',
                date:       'طوال العام',
              },
            ],
          },
        ],
      },
    ],
    language:  'ar',
    dir:       'rtl',
    createdAt: NOW,
    updatedAt: NOW,
  }
}

export function makeBlankActionPlan(lang: 'en' | 'ar' = 'ar'): ActionPlanDocument {
  const now = new Date().toISOString()
  const uid = Date.now().toString(36)
  const isAR = lang === 'ar'
  return {
    id:   `ap-${uid}`,
    meta: {
      title:           isAR ? 'تقييم الخطة التنفيذية' : 'Executive Plan Evaluation Report',
      subtitle:        isAR
        ? `لعام ${new Date().getFullYear()}-${new Date().getFullYear() - 1}`
        : `Academic Year ${new Date().getFullYear() - 1}–${new Date().getFullYear()}`,
      orgName:         '',
      orgLogoUrl:      null,
      partnerLogoUrls: [],
    },
    sections: [
      {
        id:         `sec-${uid}`,
        goalNumber: 1,
        goalTitle:  isAR ? 'أدخل عنوان الغاية' : 'Enter goal title',
        objectives: [
          {
            id:        `obj-${uid}`,
            objective: isAR ? 'الهدف الأول: أدخل الهدف' : 'Objective 1: Enter objective',
            rows: [
              {
                id:         `row-${uid}`,
                activities: '',
                indicators: '',
                completed:  '',
                inProgress: '',
                reasons:    '',
                date:       '',
              },
            ],
          },
        ],
      },
    ],
    language:  lang,
    dir:       isAR ? 'rtl' : 'ltr',
    createdAt: now,
    updatedAt: now,
  }
}
