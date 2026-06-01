# Project AhaSlides e-Learning — Project Thesis

**Source:** https://ahaslides.atlassian.net/wiki/spaces/AT/pages/1881866288/Project+AhaSlides+e-Learning  
**Last fetched:** 2026-06-01  
**Note:** This document may be updated periodically as the Confluence page evolves. Re-fetch when stale (the page was last modified 2026-05-08).

---

# Strategic Thesis

**From live sessions to full learning journeys.**

---

## The Problem

Our trainers hit the same wall: when the live session ends, the learning stops. To deliver ongoing training, they stitch together separate tools — a slide deck here, a Thinkific course there, a Google Form for assessment. It should be one seamless experience.

AhaSlides Learning removes the stitching.

---

## The Thesis

**Trainers build interactive courses on AhaSlides. Learners complete them at their own pace.**

We are cloning a proven model — Thinkific, Teachable, LearnWorlds — where creators build structured courses and learners work through them independently. Thinkific alone reached ~$60M ARR serving 35,000+ customers across 100+ countries.

The difference: we are not starting from zero. We already have the engagement layer these platforms lack.

---

## Why AhaSlides Wins

**The content already exists.** Trainers have built hundreds of thousands of interactive presentations. Every quiz, poll, and Q&A slide is a learning activity waiting to become part of a self-paced course.

**The synergy is the moat.** This is the critical insight:

* Run a live workshop on Monday → convert it into a self-paced course for reinforcement or catch-up.
* Build a self-paced onboarding course → pull out discussion-worthy sections for a live follow-up.
* Create once, deliver both ways. No course platform offers this.

**Our users are already trainers.** We don't need a new audience. Corporate trainers, educators, and coaches — the people who create courses — are already on AhaSlides.

---

## The Market Is Huge. The Gap Is Real.

[Blended learning](https://en.wikipedia.org/wiki/Blended_learning) — combining live and self-paced — is a ~$28B market growing at 12.7% CAGR. 70% of employees prefer self-paced, but pure self-paced has a completion problem (20–30% vs. 75–85% for live). The industry knows blended is the answer. So why hasn't anyone nailed it?

Because the market evolved in two lanes that never merged.

* Course platforms (Thinkific, Teachable) optimised for publishing — their "live" is a Zoom link bolted on.
* Engagement tools (AhaSlides, Kahoot, Mentimeter) optimised for live moments — none offer async course delivery.
* Enterprise LMS (Docebo, Moodle) handles both but is built for IT admins, not trainers.

Kahoot is the closest, but starts from lightweight quizzes — you can't build a rich course on it. TrainerCentral (Zoho) tries the integrated approach, but their live sessions are basic video calls, not interactive engagement.

The gap is architectural: building a product that does both well requires starting as an engagement tool and extending into courses. That's us.

---

## In Practice: Two Directions, One Platform

Sarah runs onboarding for a 500-person company.

**Course-first** (the [flex model](https://en.wikipedia.org/wiki/Flex_model_of_learning)): Sarah publishes her onboarding materials as a self-paced course. New joiners complete it in Week 1. She watches progress on a dashboard, spots where learners struggle, and pulls those topics into a live AhaSlides session for discussion and practice. Knowledge transfer happens async; live time is protected for application.

**Live-first** (the [sandwich model](https://openpress.sussex.ac.uk/ideasforactivelearning/chapter/33-the-sandwich-model-a-supportive-framework-for-blended-learning/)): Sarah runs a live workshop. Session results show trainees consistently score low on certain modules. She converts those sections into self-paced lessons and sends them out as post-session reinforcement — so her next live session can move forward instead of going back.

Both are established [blended learning patterns](https://en.wikipedia.org/wiki/Blended_learning). A course becomes a live session. A live session becomes a course. Same content, same platform, no rebuilding.

**The Vani story:** Vani is a corporate trainer at KiotViet — one of AhaSlides' most engaged power users who ran live sessions regularly to train hundreds of staff. She eventually published her full training materials as a self-paced online course built outside AhaSlides. Her trainees could go through materials on their own time; managers preferred it because live training was disruptive to operations.

We didn't lose Vani to a competitor. We lost her to a use case we don't support yet. She still needed interactive training content. She still needed engagement. But she also needed self-paced delivery — and we couldn't give her that. So she built it elsewhere.

With AhaSlides Learning, Vani converts her existing AhaSlides presentations into self-paced courses her trainees complete on their own schedule. She runs a live session monthly for Q&A and discussion. She stays on AhaSlides for both.

---

## Business Impact

**Revenue:** Self-paced courses unlock per-learner seats and higher-tier plans, driving ACV up.  
**Retention:** Course content is sticky — trainers who build courses don't churn.  
**TAM:** We open to the ~$28B blended learning market without leaving our core.

---

## What We Are NOT Building

Not a full LMS. Not a course marketplace. Not competing with Moodle or Blackboard. We are the simple, beautiful, interactive course builder for trainers — with a seamless bridge between live and self-paced that nobody else owns.

---

_Save the world from sleepy meetings, boring training, and tuned-out teams — even when the trainer isn't in the room._

---

## Relevance to Waterloo (WAT tasks)

The Waterloo project (`waterloo.ahaslides-game.workers.dev`) is the frontend scaffold for AhaSlides e-Learning. Key concepts that map to work items:

- **Lessons** — the core unit of self-paced content; individual slides/activities a learner steps through
- **Converter** — the mechanism to take an existing AhaSlides presentation and convert it into a self-paced course
- **Pick-answer / quiz slides** — the interactive engagement layer (polls, Q&As, quizzes) that differentiates AhaSlides courses from static video content
- **Progress dashboard** — course creator view showing where learners struggle (informs live follow-up sessions)
- **Blended delivery** — the live ↔ self-paced bridge that is AhaSlides' core moat
